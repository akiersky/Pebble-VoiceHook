// Webhook watchapp. Select dictates a note, Up/Down send fixed commands (press, double press, hold).
// Everything is relayed to the phone over AppMessage; the phone side calls the bundled Webhook plugin.
#include <pebble.h>

#define DICTATION_BUFFER 512
#define REPLY_TIMEOUT_MS 20000
#define RESULT_SHOW_MS 1800
#define ANIMATION_MS 520
#define FRAME_MS 33

typedef enum { StateIdle, StateSending, StateOk, StateFail } State;

static Window *s_window;
static Layer *s_canvas;
static TextLayer *s_title_layer;
static TextLayer *s_message_layer;
static DictationSession *s_dictation;
static AppTimer *s_frame_timer;
static AppTimer *s_reset_timer;
static AppTimer *s_timeout_timer;
static State s_state = StateIdle;
static time_t s_anim_start_s;
static uint16_t s_anim_start_ms;
static char s_message[96];

// Thumbs-up outline in a 100x100 box, and the cuff beside it.
static const GPoint HAND[] = {
  {30, 46}, {46, 44}, {54, 20}, {60, 10}, {68, 12}, {70, 24}, {64, 44}, {92, 44}, {98, 52},
  {94, 62}, {98, 70}, {92, 80}, {94, 86}, {86, 94}, {32, 94},
};
static const GPoint CUFF[] = { {4, 44}, {24, 44}, {24, 94}, {4, 94} };

static int32_t prv_elapsed_ms(void) {
  time_t now_s; uint16_t now_ms;
  time_ms(&now_s, &now_ms);
  return (int32_t)(now_s - s_anim_start_s) * 1000 + (int32_t)now_ms - (int32_t)s_anim_start_ms;
}

// Scale 0..1000 permille: pops in past full size and settles.
static int prv_pop_scale(int32_t elapsed) {
  if (elapsed >= ANIMATION_MS) return 1000;
  int t = elapsed * 1000 / ANIMATION_MS;
  if (t < 700) return t * 1150 / 700;
  return 1150 - (t - 700) * 150 / 300;
}

static void prv_draw_poly(GContext *ctx, const GPoint *base, int count, GPoint center, int size, int scale) {
  GPoint points[16];
  for (int i = 0; i < count; i++) {
    points[i].x = center.x + (base[i].x - 50) * size * scale / 100000;
    points[i].y = center.y + (base[i].y - 50) * size * scale / 100000;
  }
  GPathInfo info = { .num_points = count, .points = points };
  GPath *path = gpath_create(&info);
  gpath_draw_filled(ctx, path);
  gpath_destroy(path);
}

static void prv_draw_thumb(GContext *ctx, GPoint center, int size, int scale) {
  prv_draw_poly(ctx, HAND, ARRAY_LENGTH(HAND), center, size, scale);
  prv_draw_poly(ctx, CUFF, ARRAY_LENGTH(CUFF), center, size, scale);
}

static void prv_draw_cross(GContext *ctx, GPoint center, int size, int scale, int shake) {
  int half = size * scale / 2000 * 7 / 10;
  center.x += shake;
  graphics_context_set_stroke_width(ctx, 9);
  graphics_draw_line(ctx, GPoint(center.x - half, center.y - half), GPoint(center.x + half, center.y + half));
  graphics_draw_line(ctx, GPoint(center.x + half, center.y - half), GPoint(center.x - half, center.y + half));
}

static void prv_draw_mic(GContext *ctx, GPoint center, int size) {
  int w = size * 3 / 10;
  int h = size * 5 / 10;
  GRect body = GRect(center.x - w / 2, center.y - size / 2, w, h);
  graphics_fill_rect(ctx, body, w / 2, GCornersAll);
  graphics_context_set_stroke_width(ctx, 4);
  GRect cradle = GRect(center.x - w, center.y - size / 2 + h / 4, w * 2, h);
  graphics_draw_arc(ctx, cradle, GOvalScaleModeFitCircle, DEG_TO_TRIGANGLE(100), DEG_TO_TRIGANGLE(260));
  graphics_draw_line(ctx, GPoint(center.x, center.y + size / 4 + 2), GPoint(center.x, center.y + size / 2));
  graphics_draw_line(ctx, GPoint(center.x - w / 2, center.y + size / 2), GPoint(center.x + w / 2, center.y + size / 2));
}

static void prv_canvas_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  GPoint center = GPoint(bounds.size.w / 2, bounds.size.h * 46 / 100);
  int size = (bounds.size.w < bounds.size.h ? bounds.size.w : bounds.size.h) * 5 / 10;
  int32_t elapsed = prv_elapsed_ms();
  switch (s_state) {
    case StateIdle:
      graphics_context_set_fill_color(ctx, GColorWhite);
      graphics_context_set_stroke_color(ctx, GColorWhite);
      prv_draw_mic(ctx, center, size * 8 / 10);
      break;
    case StateOk:
      graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorGreen, GColorWhite));
      graphics_context_set_stroke_color(ctx, GColorBlack);
      prv_draw_thumb(ctx, center, size, prv_pop_scale(elapsed));
      break;
    case StateFail: {
      graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorRed, GColorWhite));
      int shake = 0;
      if (elapsed < ANIMATION_MS) {
        int32_t angle = TRIG_MAX_ANGLE * elapsed * 3 / ANIMATION_MS;
        shake = sin_lookup(angle) * 8 * (ANIMATION_MS - elapsed) / ANIMATION_MS / TRIG_MAX_RATIO;
      }
      prv_draw_cross(ctx, center, size, prv_pop_scale(elapsed), shake);
      break;
    }
    case StateSending:
      break;
  }
}

static void prv_set_message(const char *text) {
  snprintf(s_message, sizeof(s_message), "%s", text);
  text_layer_set_text(s_message_layer, s_message);
}

static void prv_cancel(AppTimer **timer) {
  if (*timer) { app_timer_cancel(*timer); *timer = NULL; }
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
  s_state = StateIdle;
  prv_set_message("Select: speak\nUp/Down: commands");
  layer_mark_dirty(s_canvas);
}

static void prv_show(State state, const char *text) {
  prv_cancel(&s_timeout_timer);
  prv_cancel(&s_reset_timer);
  prv_cancel(&s_frame_timer);
  s_state = state;
  prv_set_message(text);
  if (state == StateOk || state == StateFail) {
    time_ms(&s_anim_start_s, &s_anim_start_ms);
    s_frame_timer = app_timer_register(FRAME_MS, prv_frame, NULL);
    s_reset_timer = app_timer_register(RESULT_SHOW_MS, prv_reset, NULL);
    if (state == StateOk) vibes_short_pulse(); else vibes_double_pulse();
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

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
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
  }
  // Other outcomes (cancelled, rejected, errors) already show the system's own dialog.
}

static void prv_select(ClickRecognizerRef recognizer, void *context) {
  if (s_state == StateSending) return;
  prv_cancel(&s_reset_timer);
  s_state = StateIdle;
  layer_mark_dirty(s_canvas);
  dictation_session_start(s_dictation);
}

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
  window_set_background_color(window, GColorBlack);

  s_canvas = layer_create(bounds);
  layer_set_update_proc(s_canvas, prv_canvas_update);
  layer_add_child(root, s_canvas);

  s_title_layer = text_layer_create(GRect(0, PBL_IF_ROUND_ELSE(14, 6), bounds.size.w, 30));
  text_layer_set_text(s_title_layer, "Webhook");
  text_layer_set_font(s_title_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_title_layer, GTextAlignmentCenter);
  text_layer_set_text_color(s_title_layer, GColorWhite);
  text_layer_set_background_color(s_title_layer, GColorClear);
  layer_add_child(root, text_layer_get_layer(s_title_layer));

  int message_y = bounds.size.h * 70 / 100;
  s_message_layer = text_layer_create(GRect(8, message_y, bounds.size.w - 16, bounds.size.h - message_y - 4));
  text_layer_set_font(s_message_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_message_layer, GTextAlignmentCenter);
  text_layer_set_text_color(s_message_layer, GColorWhite);
  text_layer_set_background_color(s_message_layer, GColorClear);
  layer_add_child(root, text_layer_get_layer(s_message_layer));
  prv_set_message("Select: speak\nUp/Down: commands");
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_message_layer);
  text_layer_destroy(s_title_layer);
  layer_destroy(s_canvas);
}

static void prv_init(void) {
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
