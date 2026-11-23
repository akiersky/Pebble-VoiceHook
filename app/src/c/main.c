// Webhook watchapp. Select dictates a note, Up/Down send fixed commands (press, double press, hold).
// Everything is relayed to the phone over AppMessage; the phone side calls the bundled Webhook plugin.
// Launched from a Quick Launch button, it starts dictating at once and closes after the confirmation.
#include <pebble.h>

#define DICTATION_BUFFER 512
#define REPLY_TIMEOUT_MS 20000
#define RESULT_SHOW_MS 1800
#define ANIMATION_MS 700
#define FRAME_MS 33
#define LABEL_MAX 25
#define ICON_COUNT 5

enum { PersistUpLabel = 1, PersistDownLabel = 2 };

typedef enum { StateIdle, StateSending, StateOk, StateFail } State;

static Window *s_window;
static Layer *s_canvas;
static TextLayer *s_message_layer;
static DictationSession *s_dictation;
static AppTimer *s_frame_timer;
static AppTimer *s_reset_timer;
static AppTimer *s_timeout_timer;
static GBitmap *s_mic;
static GBitmap *s_confirm_icons[ICON_COUNT];
static State s_state = StateIdle;
static int s_confirm = 0;
static bool s_quick_launch = false;
static time_t s_anim_start_s;
static uint16_t s_anim_start_ms;
static char s_message[96];
static char s_up_label[LABEL_MAX];
static char s_down_label[LABEL_MAX];

static const uint32_t CONFIRM_RESOURCES[ICON_COUNT] = {
  RESOURCE_ID_IMAGE_ROCKET, RESOURCE_ID_IMAGE_THUMBS_UP, RESOURCE_ID_IMAGE_MUSIC,
  RESOURCE_ID_IMAGE_TIDE, RESOURCE_ID_IMAGE_SENT,
};

static GColor prv_confirm_background(int index) {
  switch (index) {
    case 0: return PBL_IF_COLOR_ELSE(GColorPictonBlue, GColorWhite);
    case 1: return PBL_IF_COLOR_ELSE(GColorMediumAquamarine, GColorWhite);
    case 2: return PBL_IF_COLOR_ELSE(GColorMelon, GColorWhite);
    case 3: return PBL_IF_COLOR_ELSE(GColorYellow, GColorWhite);
    default: return PBL_IF_COLOR_ELSE(GColorMalachite, GColorWhite);
  }
}

static int32_t prv_elapsed_ms(void) {
  time_t now_s; uint16_t now_ms;
  time_ms(&now_s, &now_ms);
  return (int32_t)(now_s - s_anim_start_s) * 1000 + (int32_t)now_ms - (int32_t)s_anim_start_ms;
}

// Vertical offset of a drop-and-bounce: starts above its place, hits it and bounces smaller each time.
static int prv_bounce_offset(int32_t elapsed, int height) {
  if (elapsed >= ANIMATION_MS) return 0;
  int32_t angle = TRIG_MAX_ANGLE * 5 * elapsed / (4 * ANIMATION_MS);
  int32_t cosine = cos_lookup(angle);
  if (cosine < 0) cosine = -cosine;
  return -(int)((int32_t)height * cosine / TRIG_MAX_RATIO * (ANIMATION_MS - elapsed) / ANIMATION_MS);
}

#if defined(PBL_ROUND)
static int prv_isqrt(int value) {
  int root = 0;
  while ((root + 1) * (root + 1) <= value) root++;
  return root;
}
#endif

// The x where a horizontal line at y reaches the visible edge of the screen.
static int prv_edge_x(GRect bounds, int y) {
#if defined(PBL_ROUND)
  int r = bounds.size.w / 2;
  int dy = y - bounds.size.h / 2;
  return bounds.size.w / 2 + prv_isqrt(r * r - dy * dy) - 6;
#else
  return bounds.size.w - 4;
#endif
}

static void prv_draw_arrow(GContext *ctx, GPoint from, GPoint to) {
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_context_set_stroke_width(ctx, 3);
  graphics_draw_line(ctx, from, to);
  graphics_draw_line(ctx, to, GPoint(to.x - 8, to.y - 7));
  graphics_draw_line(ctx, to, GPoint(to.x - 8, to.y + 7));
}

// A reminder the user wrote, right-aligned beside an arrow pointing at its button.
static void prv_draw_button_label(GContext *ctx, GRect bounds, int y, const char *text) {
  if (!text[0]) return;
  int edge = prv_edge_x(bounds, y);
  int left = PBL_IF_ROUND_ELSE(bounds.size.w / 5, 6);
  GRect rect = GRect(left, y - 13, edge - 26 - left, 26);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, text, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), rect,
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
  prv_draw_arrow(ctx, GPoint(edge - 20, y), GPoint(edge, y));
}

static void prv_draw_cross(GContext *ctx, GPoint center, int size, int32_t elapsed) {
  int half = size * 3 / 10;
  int shake = 0;
  if (elapsed < ANIMATION_MS) {
    int32_t angle = TRIG_MAX_ANGLE * elapsed * 4 / ANIMATION_MS;
    shake = sin_lookup(angle) * 9 * (ANIMATION_MS - elapsed) / ANIMATION_MS / TRIG_MAX_RATIO;
  }
  center.x += shake;
  graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkCandyAppleRed, GColorBlack));
  graphics_context_set_stroke_width(ctx, 10);
  graphics_draw_line(ctx, GPoint(center.x - half, center.y - half), GPoint(center.x + half, center.y + half));
  graphics_draw_line(ctx, GPoint(center.x + half, center.y - half), GPoint(center.x - half, center.y + half));
}

static void prv_canvas_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_compositing_mode(ctx, GCompOpSet);
  GColor background = GColorWhite;
  if (s_state == StateOk) background = prv_confirm_background(s_confirm);
  else if (s_state == StateFail) background = PBL_IF_COLOR_ELSE(GColorMelon, GColorWhite);
  graphics_context_set_fill_color(ctx, background);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  int32_t elapsed = prv_elapsed_ms();
  GPoint center = GPoint(bounds.size.w / 2, bounds.size.h * 4 / 10);
  switch (s_state) {
    case StateIdle: {
      // The microphone, with an arrow out to the Select button, and the user's reminders for Up and Down.
      int mic_x = (bounds.size.w - 80) / 2 - bounds.size.w / 6;
      int mid = bounds.size.h / 2;
      graphics_draw_bitmap_in_rect(ctx, s_mic, GRect(mic_x, mid - 40, 80, 80));
      prv_draw_arrow(ctx, GPoint(mic_x + 84, mid), GPoint(prv_edge_x(bounds, mid), mid));
      prv_draw_button_label(ctx, bounds, bounds.size.h * 17 / 100, s_up_label);
      prv_draw_button_label(ctx, bounds, bounds.size.h * 83 / 100, s_down_label);
      break;
    }
    case StateOk:
      graphics_draw_bitmap_in_rect(ctx, s_confirm_icons[s_confirm],
                                   GRect(center.x - 40, center.y - 40 + prv_bounce_offset(elapsed, 90), 80, 80));
      break;
    case StateFail:
      prv_draw_cross(ctx, center, 80, elapsed);
      break;
    case StateSending:
      break;
  }
}

static void prv_cancel(AppTimer **timer) {
  if (*timer) { app_timer_cancel(*timer); *timer = NULL; }
}

static void prv_set_message(const char *text) {
  snprintf(s_message, sizeof(s_message), "%s", text);
  text_layer_set_text(s_message_layer, s_message);
  layer_set_hidden(text_layer_get_layer(s_message_layer), s_state == StateIdle);
}

static void prv_frame(void *data) {
  s_frame_timer = NULL;
  layer_mark_dirty(s_canvas);
  if ((s_state == StateOk || s_state == StateFail) && prv_elapsed_ms() < ANIMATION_MS) {
    s_frame_timer = app_timer_register(FRAME_MS, prv_frame, NULL);
  }
}

static void prv_reset(void *data) {
  s_reset_timer = NULL;
  if (s_quick_launch) {
    window_stack_pop_all(true);
    return;
  }
  s_state = StateIdle;
  prv_set_message("");
  layer_mark_dirty(s_canvas);
}

static void prv_show(State state, const char *text) {
  prv_cancel(&s_timeout_timer);
  prv_cancel(&s_reset_timer);
  prv_cancel(&s_frame_timer);
  s_state = state;
  prv_set_message(text);
  if (state == StateOk || state == StateFail) {
    if (state == StateOk) {
      // A different celebration each time.
      int next = rand() % ICON_COUNT;
      if (next == s_confirm) next = (next + 1) % ICON_COUNT;
      s_confirm = next;
      vibes_short_pulse();
    } else {
      vibes_double_pulse();
    }
    time_ms(&s_anim_start_s, &s_anim_start_ms);
    s_frame_timer = app_timer_register(FRAME_MS, prv_frame, NULL);
    s_reset_timer = app_timer_register(RESULT_SHOW_MS, prv_reset, NULL);
  }
  layer_mark_dirty(s_canvas);
}

static void prv_timed_out(void *data) {
  s_timeout_timer = NULL;
  prv_show(StateFail, "No reply from the phone");
}

// Sends either dictated text (text != NULL) or a button slot (1 to 6).
static void prv_send(const char *text, int slot) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    prv_show(StateFail, "Phone not connected");
    return;
  }
  if (text) dict_write_cstring(iter, MESSAGE_KEY_TEXT, text);
  else dict_write_uint8(iter, MESSAGE_KEY_SLOT, (uint8_t)slot);
  dict_write_end(iter);
  if (app_message_outbox_send() != APP_MSG_OK) {
    prv_show(StateFail, "Could not send");
    return;
  }
  prv_show(StateSending, "Sending…");
  s_timeout_timer = app_timer_register(REPLY_TIMEOUT_MS, prv_timed_out, NULL);
}

static void prv_store_label(Tuple *tuple, char *label, uint32_t key) {
  if (!tuple) return;
  snprintf(label, LABEL_MAX, "%s", tuple->value->cstring);
  persist_write_string(key, label);
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *up = dict_find(iter, MESSAGE_KEY_UP_LABEL);
  Tuple *down = dict_find(iter, MESSAGE_KEY_DOWN_LABEL);
  if (up || down) {
    prv_store_label(up, s_up_label, PersistUpLabel);
    prv_store_label(down, s_down_label, PersistDownLabel);
    layer_mark_dirty(s_canvas);
  }
  Tuple *result = dict_find(iter, MESSAGE_KEY_RESULT);
  Tuple *message = dict_find(iter, MESSAGE_KEY_MESSAGE);
  if (!result) return;
  prv_show(result->value->int32 == 1 ? StateOk : StateFail, message ? message->value->cstring : "");
}

static void prv_outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  prv_show(StateFail, "Phone not reachable");
}

static void prv_dictation(DictationSession *session, DictationSessionStatus status, char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess && transcription && transcription[0]) {
    prv_send(transcription, 0);
    return;
  }
  // Cancelled, rejected or failed: the system already showed its own dialog if needed.
  if (s_quick_launch) window_stack_pop_all(true);
}

static void prv_start_dictation(void) {
  if (s_state == StateSending) return;
  prv_cancel(&s_reset_timer);
  s_state = StateIdle;
  prv_set_message("");
  layer_mark_dirty(s_canvas);
  dictation_session_start(s_dictation);
}

static void prv_select(ClickRecognizerRef recognizer, void *context) { prv_start_dictation(); }

static void prv_quick_start(void *data) { prv_start_dictation(); }

static void prv_command(int slot) {
  if (s_state == StateSending) return;
  prv_send(NULL, slot);
}

static void prv_up_multi(ClickRecognizerRef recognizer, void *context) {
  prv_command(click_number_of_clicks_counted(recognizer) >= 2 ? 2 : 1);
}
static void prv_down_multi(ClickRecognizerRef recognizer, void *context) {
  prv_command(click_number_of_clicks_counted(recognizer) >= 2 ? 5 : 4);
}
static void prv_up_hold(ClickRecognizerRef recognizer, void *context) { prv_command(3); }
static void prv_down_hold(ClickRecognizerRef recognizer, void *context) { prv_command(6); }

static void prv_click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select);
  window_multi_click_subscribe(BUTTON_ID_UP, 1, 2, 250, true, prv_up_multi);
  window_multi_click_subscribe(BUTTON_ID_DOWN, 1, 2, 250, true, prv_down_multi);
  window_long_click_subscribe(BUTTON_ID_UP, 600, prv_up_hold, NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, 600, prv_down_hold, NULL);
}

static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_mic = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MIC);
  for (int i = 0; i < ICON_COUNT; i++) s_confirm_icons[i] = gbitmap_create_with_resource(CONFIRM_RESOURCES[i]);

  s_canvas = layer_create(bounds);
  layer_set_update_proc(s_canvas, prv_canvas_update);
  layer_add_child(root, s_canvas);

  int message_y = bounds.size.h * 66 / 100;
  s_message_layer = text_layer_create(GRect(10, message_y, bounds.size.w - 20, bounds.size.h - message_y - 6));
  text_layer_set_font(s_message_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_message_layer, GTextAlignmentCenter);
  text_layer_set_text_color(s_message_layer, GColorBlack);
  text_layer_set_background_color(s_message_layer, GColorClear);
  layer_add_child(root, text_layer_get_layer(s_message_layer));
  prv_set_message("");
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_message_layer);
  layer_destroy(s_canvas);
  gbitmap_destroy(s_mic);
  for (int i = 0; i < ICON_COUNT; i++) gbitmap_destroy(s_confirm_icons[i]);
}

static void prv_init(void) {
  srand(time(NULL));
  s_quick_launch = launch_reason() == APP_LAUNCH_QUICK_LAUNCH;
  if (persist_exists(PersistUpLabel)) persist_read_string(PersistUpLabel, s_up_label, LABEL_MAX);
  if (persist_exists(PersistDownLabel)) persist_read_string(PersistDownLabel, s_down_label, LABEL_MAX);

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_outbox_failed(prv_outbox_failed);
  app_message_open(256, DICTATION_BUFFER + 64);

  s_dictation = dictation_session_create(DICTATION_BUFFER, prv_dictation, NULL);
  dictation_session_enable_confirmation(s_dictation, true);
  dictation_session_enable_error_dialogs(s_dictation, true);

  s_window = window_create();
  window_set_click_config_provider(s_window, prv_click_config);
  window_set_window_handlers(s_window, (WindowHandlers) { .load = prv_window_load, .unload = prv_window_unload });
  window_stack_push(s_window, true);
  if (s_quick_launch) app_timer_register(300, prv_quick_start, NULL);
}

static void prv_deinit(void) {
  prv_cancel(&s_frame_timer);
  prv_cancel(&s_reset_timer);
  prv_cancel(&s_timeout_timer);
  dictation_session_destroy(s_dictation);
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
