// VoiceHook watchapp. Select dictates a note, Up/Down send fixed commands (press, double press, hold).
// Everything is relayed to the phone over AppMessage; the phone side calls the bundled VoiceHook plugin.
// Launched from a Quick Launch button, it starts dictating at once and closes after the confirmation.
// The app closes by itself after a minute with nothing happening.
#include <pebble.h>
#include "contract.h"

#define DICTATION_BUFFER 512
#define REPLY_TIMEOUT_MS 20000
#define IDLE_TIMEOUT_MS 60000
#define MIC_ANIMATION_MS 380
#define FAIL_ANIMATION_MS 700
#define ICON_ANIMATION_MS 1100
#define MIN_RESULT_SHOW_MS 1800
#define FRAME_MS 33
#define ICON_COUNT 5
// The paper plane swoops in from the lower left before its own animation takes over.
#define SENT_FLY_IN_MS 400

// ICON_SIZE comes from contract.h, generated from screens.json, where each screen's size is set by hand.
#define ICON_HALF (ICON_SIZE / 2)
// Taller than one line of GOTHIC_24_BOLD means the message wrapped.
#define MESSAGE_LARGE_MAX_H 36
// The message sits under the icon; on a round screen it starts higher, where the circle is still wide.
#define MESSAGE_Y_PERCENT PBL_IF_ROUND_ELSE(62, 69)

enum { PersistUpLabel = 1, PersistDownLabel = 2 };

// Store screenshots only (SCREENSHOT_MODE=1 pebble build): a RESULT of 10 + n shows confirmation icon n and keeps
// it on screen, so tools/capture-screenshots.sh can photograph each one at rest. Normal builds never define it.
#if defined(SCREENSHOT_MODE)
static int s_forced_icon = -1;
static int s_freeze_percent = -1;   // RESULT 100 + n: hold the plane animation n percent of the way through
#endif

typedef enum { StateIdle, StateStarting, StateSending, StateOk, StateFail } State;
// IconSent (the paper plane, a vector animation) must stay last: it is the voice note's icon, and button
// commands pick at random from the ones before it.
typedef enum { IconRocket, IconThumbsUp, IconMusic, IconTide, IconSent } Icon;

static Window *s_window;
static Layer *s_canvas;
static TextLayer *s_message_layer;
static DictationSession *s_dictation;
static AppTimer *s_frame_timer;
static AppTimer *s_reset_timer;
static AppTimer *s_timeout_timer;
static AppTimer *s_idle_timer;
// Only the picture being shown is loaded, to keep memory low on the older watches.
static GBitmap *s_confirm_bitmap;
static GDrawCommandSequence *s_sequence;
static State s_state = StateIdle;
static Icon s_confirm = IconThumbsUp;
static int32_t s_anim_ms = ICON_ANIMATION_MS;
static bool s_quick_launch = false;
static bool s_dictating = false;
static bool s_sending_voice = false;
// The phone says nothing is set up yet, so recording or sending would only fail.
static bool s_setup_needed = false;
static time_t s_anim_start_s;
static uint16_t s_anim_start_ms;
static char s_message[WIRE_MESSAGE_MAX + 1];
static char s_up_label[LABEL_MAX];
static char s_down_label[LABEL_MAX];

static const uint32_t ICON_RESOURCES[ICON_COUNT] = {
  RESOURCE_ID_IMAGE_ROCKET, RESOURCE_ID_IMAGE_THUMBS_UP, RESOURCE_ID_IMAGE_MUSIC, RESOURCE_ID_IMAGE_TIDE, 0,
};

// ---- the microphone, drawn in code so it can move, turn and grow. Coordinates are in half-units of the 80x80 artwork.
typedef struct { int16_t x1, y1, x2, y2; uint8_t width; } MicLine;

static const GPoint MIC_HEAD[8] = {
  {90, 120}, {106, 104}, {106, 46}, {90, 30}, {72, 30}, {56, 46}, {56, 104}, {72, 120},
};
static const MicLine MIC_LINES[] = {
  {81, 31, 81, 119, 3}, {55, 75, 105, 75, 3}, {105, 57, 81, 51, 3}, {81, 99, 105, 93, 3},
  {57, 57, 81, 51, 3}, {81, 99, 57, 93, 3},
  {117, 111, 95, 133, 3}, {95, 133, 67, 133, 3}, {67, 133, 45, 111, 3},
  {81, 133, 81, 155, 3}, {62, 156, 100, 156, 4},
};

typedef struct { GPoint center; int scale_permille; int32_t angle; } MicPose;

static GPoint prv_mic_point(int x, int y, MicPose pose) {
  int dx = (x - 80) * 8;   // 1/16 of an artwork unit, from the artwork's centre
  int dy = (y - 80) * 8;
  int32_t c = cos_lookup(pose.angle);
  int32_t s = sin_lookup(pose.angle);
  int32_t rx = (dx * c - dy * s) / TRIG_MAX_RATIO;
  int32_t ry = (dx * s + dy * c) / TRIG_MAX_RATIO;
  return GPoint(pose.center.x + rx * pose.scale_permille / 16000, pose.center.y + ry * pose.scale_permille / 16000);
}

static void prv_mic_stroke(GContext *ctx, GPoint a, GPoint b, int width) {
  graphics_context_set_stroke_width(ctx, width);
  graphics_draw_line(ctx, a, b);
  int radius = width / 2;
  if (radius >= 1) {
    graphics_fill_circle(ctx, a, radius);
    graphics_fill_circle(ctx, b, radius);
  }
}

static void prv_draw_mic(GContext *ctx, MicPose pose) {
  GPoint head[8];
  for (int i = 0; i < 8; i++) head[i] = prv_mic_point(MIC_HEAD[i].x, MIC_HEAD[i].y, pose);
  GPathInfo info = { .num_points = 8, .points = head };
  GPath *path = gpath_create(&info);
  graphics_context_set_fill_color(ctx, GColorWhite);
  gpath_draw_filled(ctx, path);
  gpath_destroy(path);

  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_context_set_fill_color(ctx, GColorBlack);
  int head_width = 4 * pose.scale_permille / 1000;
  if (head_width < 1) head_width = 1;
  for (int i = 0; i < 8; i++) prv_mic_stroke(ctx, head[i], head[(i + 1) % 8], head_width);
  for (unsigned i = 0; i < ARRAY_LENGTH(MIC_LINES); i++) {
    int width = MIC_LINES[i].width * pose.scale_permille / 1000;
    if (width < 1) width = 1;
    prv_mic_stroke(ctx, prv_mic_point(MIC_LINES[i].x1, MIC_LINES[i].y1, pose),
                   prv_mic_point(MIC_LINES[i].x2, MIC_LINES[i].y2, pose), width);
  }
}

// Resting pose: tilted 65 degrees, its head pointing up toward the buttons and its base cut off by the left edge.
#define IDLE_ANGLE_DEG 65
#define IDLE_HEAD_PERCENT 54
static MicPose prv_idle_pose(GRect bounds) {
  int head_edge = bounds.size.w * IDLE_HEAD_PERCENT / 100;
  int scale = head_edge * 20;
  int32_t angle = DEG_TO_TRIGANGLE(IDLE_ANGLE_DEG);
  // The head's far edge sits 27 units from the centre along the tilted axis.
  int reach = 27 * scale / 1000;
  return (MicPose) {
    .center = GPoint(head_edge - reach * sin_lookup(angle) / TRIG_MAX_RATIO, bounds.size.h / 2),
    .scale_permille = scale,
    .angle = angle,
  };
}

// Where it ends up when recording starts: upright in the middle, where the system's recording screen shows its own.
static MicPose prv_recording_pose(GRect bounds) {
  return (MicPose) { .center = GPoint(bounds.size.w / 2, bounds.size.h / 2), .scale_permille = bounds.size.h * 6, .angle = 0 };
}

static int32_t prv_elapsed_ms(void) {
  time_t now_s; uint16_t now_ms;
  time_ms(&now_s, &now_ms);
  return (int32_t)(now_s - s_anim_start_s) * 1000 + (int32_t)now_ms - (int32_t)s_anim_start_ms;
}

static void prv_restart_clock(void) {
  time_ms(&s_anim_start_s, &s_anim_start_ms);
}

// Ease in and out; input and output are 0 to 1000.
static int prv_ease(int t) {
  if (t < 500) return 4 * t * t * t / 1000000;
  int u = 1000 - t;
  return 1000 - 4 * u * u * u / 1000000;
}

static MicPose prv_mic_in_flight(GRect bounds, int32_t elapsed) {
  int t = elapsed >= MIC_ANIMATION_MS ? 1000 : (int)(elapsed * 1000 / MIC_ANIMATION_MS);
  int e = prv_ease(t);
  MicPose from = prv_idle_pose(bounds);
  MicPose to = prv_recording_pose(bounds);
  return (MicPose) {
    .center = GPoint(from.center.x + (to.center.x - from.center.x) * e / 1000, from.center.y + (to.center.y - from.center.y) * e / 1000),
    .scale_permille = from.scale_permille + (to.scale_permille - from.scale_permille) * e / 1000,
    .angle = from.angle * (1000 - e) / 1000,
  };
}

static GColor prv_confirm_background(Icon icon) {
  switch (icon) {
    case IconRocket: return PBL_IF_COLOR_ELSE(GColorPictonBlue, GColorWhite);
    case IconThumbsUp: return PBL_IF_COLOR_ELSE(GColorMediumAquamarine, GColorWhite);
    case IconMusic: return PBL_IF_COLOR_ELSE(GColorMelon, GColorWhite);
    case IconTide: return PBL_IF_COLOR_ELSE(GColorYellow, GColorWhite);
    default: return PBL_IF_COLOR_ELSE(GColorMalachite, GColorWhite);
  }
}

// A swing that starts at +/-max_degrees, goes back and forth `swings` times and dies away by the end.
static int32_t prv_swing(int32_t elapsed, int swings, int max_degrees, int decay_percent) {
  int32_t angle = TRIG_MAX_ANGLE * swings * elapsed / s_anim_ms;
  int32_t amplitude = 100 - decay_percent * elapsed / s_anim_ms;
  return sin_lookup(angle) * DEG_TO_TRIGANGLE(max_degrees) / TRIG_MAX_RATIO * amplitude / 100;
}

// Horizontal offset of a spring: starts `distance` to the left, crosses the middle, overshoots a little and
// settles. The overshoot is halved so the icon stays on the screen once it has arrived.
static int prv_slide_offset(int32_t elapsed, int distance) {
  if (elapsed >= s_anim_ms) return 0;
  int32_t cosine = cos_lookup(TRIG_MAX_ANGLE * elapsed / s_anim_ms);
  int32_t left = s_anim_ms - elapsed;
  int32_t decay = left * left / s_anim_ms * left / s_anim_ms;   // (1 - t)^3, in the same units as s_anim_ms
  int offset = -(int)((int32_t)distance * cosine / TRIG_MAX_RATIO * decay / s_anim_ms);
  return cosine < 0 ? offset / 2 : offset;
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

// Every arrow is the same size and the same distance from the edge, one for each button.
static void prv_draw_button_arrow(GContext *ctx, GRect bounds, int y) {
  int edge = prv_edge_x(bounds, y);
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_context_set_stroke_width(ctx, 3);
  graphics_draw_line(ctx, GPoint(edge - 20, y), GPoint(edge, y));
  graphics_draw_line(ctx, GPoint(edge, y), GPoint(edge - 8, y - 7));
  graphics_draw_line(ctx, GPoint(edge, y), GPoint(edge - 8, y + 7));
}

// A reminder the user wrote, right-aligned beside an arrow pointing at its button.
static void prv_draw_button_label(GContext *ctx, GRect bounds, int y, const char *text) {
  if (!text[0]) return;
  int edge = prv_edge_x(bounds, y);
  int left = PBL_IF_ROUND_ELSE(bounds.size.w / 5, 6);
  GRect rect = GRect(left, y - 19, edge - 26 - left, 38);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, text, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD), rect,
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
  prv_draw_button_arrow(ctx, bounds, y);
}

static void prv_draw_cross(GContext *ctx, GPoint center, int size, int32_t elapsed) {
  int half = size * 3 / 10;
  int shake = 0;
  if (elapsed < s_anim_ms) {
    int32_t angle = TRIG_MAX_ANGLE * elapsed * 4 / s_anim_ms;
    shake = sin_lookup(angle) * 9 * (s_anim_ms - elapsed) / s_anim_ms / TRIG_MAX_RATIO;
  }
  center.x += shake;
  graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkCandyAppleRed, GColorBlack));
  graphics_context_set_stroke_width(ctx, 10);
  graphics_draw_line(ctx, GPoint(center.x - half, center.y - half), GPoint(center.x + half, center.y + half));
  graphics_draw_line(ctx, GPoint(center.x + half, center.y - half), GPoint(center.x - half, center.y + half));
}

static void prv_draw_icon(GContext *ctx, GPoint at, int32_t angle) {
  if (angle == 0) {
    graphics_draw_bitmap_in_rect(ctx, s_confirm_bitmap, GRect(at.x - ICON_HALF, at.y - ICON_HALF, ICON_SIZE, ICON_SIZE));
  } else {
    graphics_draw_rotated_bitmap(ctx, s_confirm_bitmap, GPoint(ICON_HALF, ICON_HALF), angle, at);
  }
}

// Each confirmation icon has its own motion.
static void prv_draw_confirm(GContext *ctx, GPoint center, int32_t elapsed) {
  int32_t t = elapsed < s_anim_ms ? elapsed : s_anim_ms;
  switch (s_confirm) {
    case IconRocket: {
      // Rumbles on the pad, then blasts off toward the top right and out of sight.
      GPoint at = center;
      if (t < 300) {
        at.x += (t / 45) % 2 ? 3 : -3;
        at.y += (t / 30) % 2 ? 2 : -2;
      } else if (t < 1000) {
        int32_t u = t - 300;
        int dist = u * u / 2200 * ICON_SIZE / 80;
        at.x += dist * 7 / 10;
        at.y -= dist * 7 / 10;
      } else {
        return;
      }
      prv_draw_icon(ctx, at, 0);
      break;
    }
    case IconThumbsUp: {
      // Slides in from the left like a spring, then wobbles as it settles. A rotated bitmap is only drawn once it
      // is wholly on the screen, so it never has to be clipped at an edge while turning.
      int screen_w = center.x * 2;
      GPoint at = GPoint(center.x + prv_slide_offset(t, center.x + ICON_HALF), center.y);
      int32_t ramp = t < s_anim_ms * 4 / 10 ? t * 10 / (s_anim_ms * 4) : 10;   // the wobble builds up over 40%, in tenths
      int32_t wobble = prv_swing(t, 3, 22, 100) * ramp / 10;
      bool on_screen = at.x - ICON_HALF >= 0 && at.x + ICON_HALF <= screen_w;
      prv_draw_icon(ctx, at, on_screen ? wobble : 0);
      break;
    }
    case IconMusic:
      // Rocking side to side to the beat, hopping on each swing.
      prv_draw_icon(ctx, GPoint(center.x, center.y - abs(prv_swing(t, 5, 10, 50)) / 400), prv_swing(t, 5, 14, 50));
      break;
    case IconTide:
      // A waving shaka.
      prv_draw_icon(ctx, center, prv_swing(t, 4, 22, 60));
      break;
    case IconSent:
      if (s_sequence) {
        // The plane first flies in, then its own animation plays.
        int32_t fly_in = SENT_FLY_IN_MS;
        int32_t last = (int32_t)gdraw_command_sequence_get_total_duration(s_sequence) - 1;
        int32_t play = t - fly_in;
#if defined(SCREENSHOT_MODE)
        if (s_freeze_percent >= 0) play = last * s_freeze_percent / 100;
#endif
        GPoint origin = GPoint(center.x - ICON_HALF, center.y - ICON_HALF);
        if (play < 0) {
          // Ease-out from below and to the left of the screen onto the animation's first pose.
          int32_t u = 1000 + play * 1000 / SENT_FLY_IN_MS;
          int32_t left = 1000 - u;
          int32_t remaining = left * left / 1000 * left / 1000;
          origin.x -= (center.x + ICON_HALF) * remaining / 1000;
          origin.y += (center.y + ICON_HALF) * remaining / 1000;
          play = 0;
        }
        GDrawCommandFrame *frame = gdraw_command_sequence_get_frame_by_elapsed(s_sequence, play < last ? play : last);
        if (frame) gdraw_command_frame_draw(ctx, s_sequence, frame, origin);
      }
      break;
  }
}

// Three dots that swell in turn while the phone is sending.
static void prv_draw_sending_dots(GContext *ctx, GPoint center, int32_t elapsed) {
  graphics_context_set_fill_color(ctx, GColorBlack);
  for (int i = 0; i < 3; i++) {
    int32_t angle = (TRIG_MAX_ANGLE * elapsed / 900 + i * (TRIG_MAX_ANGLE / 3)) % TRIG_MAX_ANGLE;
    int radius = 6 + (sin_lookup(angle) + TRIG_MAX_RATIO) * 5 / (2 * TRIG_MAX_RATIO);
    graphics_fill_circle(ctx, GPoint(center.x + (i - 1) * 28, center.y), radius);
  }
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
  // The icon rests just above the message.
  int center_y = bounds.size.h * MESSAGE_Y_PERCENT / 100 - ICON_HALF - 2;
  // On a round screen keep clear of the curved top edge.
  int min_center_y = ICON_HALF + PBL_IF_ROUND_ELSE(10, 0);
  if (center_y < min_center_y) center_y = min_center_y;
  GPoint center = GPoint(bounds.size.w / 2, center_y);
  switch (s_state) {
    case StateIdle:
      if (s_setup_needed) {
        graphics_context_set_text_color(ctx, GColorBlack);
        graphics_draw_text(ctx, "Set up VoiceHook in the phone app", fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                           GRect(12, bounds.size.h / 2 - 56, bounds.size.w - 24, 112),
                           GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
        break;
      }
      prv_draw_mic(ctx, prv_idle_pose(bounds));
      prv_draw_button_arrow(ctx, bounds, bounds.size.h / 2);
      prv_draw_button_label(ctx, bounds, bounds.size.h * 17 / 100, s_up_label);
      prv_draw_button_label(ctx, bounds, bounds.size.h * 83 / 100, s_down_label);
      break;
    case StateStarting:
      prv_draw_mic(ctx, prv_mic_in_flight(bounds, elapsed));
      break;
    case StateSending:
      prv_draw_sending_dots(ctx, center, elapsed);
      break;
    case StateOk:
      prv_draw_confirm(ctx, center, elapsed);
      break;
    case StateFail:
      prv_draw_cross(ctx, center, ICON_SIZE, elapsed);
      break;
  }
}

static void prv_cancel(AppTimer **timer) {
  if (*timer) { app_timer_cancel(*timer); *timer = NULL; }
}

// ---- closing after a minute of nothing
static void prv_idle_expired(void *data);

static void prv_activity(void) {
  prv_cancel(&s_idle_timer);
  s_idle_timer = app_timer_register(IDLE_TIMEOUT_MS, prv_idle_expired, NULL);
}

static void prv_idle_expired(void *data) {
  s_idle_timer = NULL;
  if (s_dictating || s_state == StateSending || s_state == StateStarting) {
    prv_activity();   // busy, look again in a minute
    return;
  }
  window_stack_pop_all(true);
}

// The Sent animation is drawn in an 80x80 box; scale every point and stroke once, when it is loaded.
static void prv_scale_sequence(GDrawCommandSequence *sequence) {
  uint32_t frames = gdraw_command_sequence_get_num_frames(sequence);
  for (uint32_t i = 0; i < frames; i++) {
    GDrawCommandList *list = gdraw_command_frame_get_command_list(gdraw_command_sequence_get_frame_by_index(sequence, i));
    uint32_t commands = gdraw_command_list_get_num_commands(list);
    for (uint32_t j = 0; j < commands; j++) {
      GDrawCommand *command = gdraw_command_list_get_command(list, j);
      uint16_t points = gdraw_command_get_num_points(command);
      for (uint16_t k = 0; k < points; k++) {
        GPoint point = gdraw_command_get_point(command, k);
        gdraw_command_set_point(command, k, GPoint(point.x * ICON_SIZE / 80, point.y * ICON_SIZE / 80));
      }
      gdraw_command_set_stroke_width(command, gdraw_command_get_stroke_width(command) * ICON_SIZE / 80);
    }
  }
}

static void prv_free_confirm(void) {
  if (s_confirm_bitmap) { gbitmap_destroy(s_confirm_bitmap); s_confirm_bitmap = NULL; }
  if (s_sequence) { gdraw_command_sequence_destroy(s_sequence); s_sequence = NULL; }
}

// A voice note always gets the paper plane. A button command gets one of the others, never the same as last time.
static void prv_pick_confirm(bool voice_note) {
  prv_free_confirm();
  Icon next = IconSent;
#if defined(SCREENSHOT_MODE)
  if (s_forced_icon >= 0) { voice_note = true; next = (Icon)s_forced_icon; }
#endif
  if (!voice_note) {
    next = (Icon)(rand() % IconSent);
    if (next == s_confirm) next = (Icon)((next + 1) % IconSent);
  }
  s_anim_ms = ICON_ANIMATION_MS;
  if (next == IconSent) {
    s_sequence = gdraw_command_sequence_create_with_resource(RESOURCE_ID_SENT_ANIM);
    if (s_sequence) {
      prv_scale_sequence(s_sequence);
      s_anim_ms = (int32_t)gdraw_command_sequence_get_total_duration(s_sequence) + SENT_FLY_IN_MS;
    } else {
      next = IconThumbsUp;
    }
  }
  if (next != IconSent) {
    s_confirm_bitmap = gbitmap_create_with_resource(ICON_RESOURCES[next]);
    if (!s_confirm_bitmap) next = IconSent;   // (its animation then simply does not draw)
  }
  s_confirm = next;
}

static void prv_set_message(const char *text) {
  snprintf(s_message, sizeof(s_message), "%s", text);
  // One line (at most MESSAGE_LARGE_MAX_H tall) gets the large font; anything longer gets the smaller one, and
  // whatever still does not fit is cut off with an ellipsis rather than spilling out of the layer.
  GFont large = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GSize size = graphics_text_layout_get_content_size(s_message, large, layer_get_bounds(text_layer_get_layer(s_message_layer)),
                                                     GTextOverflowModeWordWrap, GTextAlignmentCenter);
  text_layer_set_font(s_message_layer, size.h > MESSAGE_LARGE_MAX_H ? fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD) : large);
  text_layer_set_overflow_mode(s_message_layer, GTextOverflowModeTrailingEllipsis);
  text_layer_set_text(s_message_layer, s_message);
  layer_set_hidden(text_layer_get_layer(s_message_layer), s_state == StateIdle || s_state == StateStarting);
}

static void prv_frame(void *data) {
  s_frame_timer = NULL;
  layer_mark_dirty(s_canvas);
  int32_t elapsed = prv_elapsed_ms();
  if (s_state == StateStarting && elapsed >= MIC_ANIMATION_MS) {
    // The microphone has reached the recording position: now listen.
    if (!s_dictating) {
      s_dictating = true;
      dictation_session_start(s_dictation);
    }
    return;
  }
  bool going = (s_state == StateStarting) || (s_state == StateSending) ||
               ((s_state == StateOk || s_state == StateFail) && elapsed < s_anim_ms);
  if (going) s_frame_timer = app_timer_register(FRAME_MS, prv_frame, NULL);
}

static void prv_back_to_idle(void) {
  prv_cancel(&s_frame_timer);
  s_state = StateIdle;
  prv_free_confirm();
  prv_set_message("");
  layer_mark_dirty(s_canvas);
}

static void prv_reset(void *data) {
  s_reset_timer = NULL;
  if (s_quick_launch) {
    window_stack_pop_all(true);
    return;
  }
  prv_back_to_idle();
}

static void prv_show(State state, const char *text) {
  prv_activity();
  prv_cancel(&s_timeout_timer);
  prv_cancel(&s_reset_timer);
  prv_cancel(&s_frame_timer);
  s_state = state;
  prv_set_message(text);
  if (state == StateOk || state == StateFail) {
    prv_free_confirm();
    if (state == StateOk) {
      prv_pick_confirm(s_sending_voice);
      vibes_short_pulse();
    } else {
      s_anim_ms = FAIL_ANIMATION_MS;
      vibes_double_pulse();
    }
    prv_restart_clock();
    s_frame_timer = app_timer_register(FRAME_MS, prv_frame, NULL);
    int show_ms = s_anim_ms + 700;
#if defined(SCREENSHOT_MODE)
    show_ms = 50000;
#endif
    s_reset_timer = app_timer_register(show_ms > MIN_RESULT_SHOW_MS ? show_ms : MIN_RESULT_SHOW_MS, prv_reset, NULL);
  } else if (state == StateSending) {
    prv_restart_clock();
    s_frame_timer = app_timer_register(FRAME_MS, prv_frame, NULL);
  }
  layer_mark_dirty(s_canvas);
}

static void prv_timed_out(void *data) {
  s_timeout_timer = NULL;
  prv_show(StateFail, "No reply from the phone");
}

// Sends either dictated text (text != NULL) or a button slot (one of the SLOT_ numbers).
static void prv_send(const char *text, int slot) {
  DictionaryIterator *iter;
  s_sending_voice = text != NULL;
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
  Tuple *configured = dict_find(iter, MESSAGE_KEY_CONFIGURED);
  if (configured) {
    s_setup_needed = configured->value->int32 == 0;
    layer_mark_dirty(s_canvas);
  }
  if (up || down) {
    prv_store_label(up, s_up_label, PersistUpLabel);
    prv_store_label(down, s_down_label, PersistDownLabel);
    layer_mark_dirty(s_canvas);
  }
  Tuple *result = dict_find(iter, MESSAGE_KEY_RESULT);
  Tuple *message = dict_find(iter, MESSAGE_KEY_MESSAGE);
  if (!result) return;
#if defined(SCREENSHOT_MODE)
  if (result->value->int32 >= 100) {
    s_forced_icon = IconSent;
    s_freeze_percent = result->value->int32 - 100;
    prv_show(StateOk, message ? message->value->cstring : "");
    return;
  }
  if (result->value->int32 >= 10) {
    s_forced_icon = result->value->int32 - 10;
    s_freeze_percent = -1;
    prv_show(StateOk, message ? message->value->cstring : "");
    return;
  }
#endif
  prv_show(result->value->int32 == RESULT_OK ? StateOk : StateFail, message ? message->value->cstring : "");
}

static void prv_outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  prv_show(StateFail, "Phone not reachable");
}

static void prv_dictation(DictationSession *session, DictationSessionStatus status, char *transcription, void *context) {
  s_dictating = false;
  prv_activity();
  if (status == DictationSessionStatusSuccess && transcription && transcription[0]) {
    prv_send(transcription, 0);
    return;
  }
  // Cancelled, rejected or failed: the system already showed its own dialog if needed.
  if (s_quick_launch) window_stack_pop_all(true);
  else prv_back_to_idle();
}

// The microphone swings to the middle and stands up, then recording begins (see prv_frame).
static void prv_start_dictation(void) {
  if (s_state == StateSending || s_state == StateStarting) return;
  if (s_setup_needed) {
    prv_show(StateFail, "Set up VoiceHook on your phone first");
    return;
  }
  prv_activity();
  prv_cancel(&s_reset_timer);
  prv_cancel(&s_frame_timer);
  prv_free_confirm();
  s_state = StateStarting;
  prv_set_message("");
  prv_restart_clock();
  s_frame_timer = app_timer_register(FRAME_MS, prv_frame, NULL);
  layer_mark_dirty(s_canvas);
}

static void prv_select(ClickRecognizerRef recognizer, void *context) { prv_start_dictation(); }

#if defined(_PBL_API_EXISTS_touch_service_subscribe)
// On watches with a touchscreen, tapping the microphone starts a voice note too.
static void prv_touch(const TouchEvent *event, void *context) {
  prv_activity();
  if (event->type != TouchEvent_Touchdown || s_state != StateIdle || s_dictating) return;
  GRect bounds = layer_get_bounds(window_get_root_layer(s_window));
  MicPose pose = prv_idle_pose(bounds);
  // The microphone's visible area: around its head, which is the part on screen.
  GRect mic = GRect(0, pose.center.y - bounds.size.h / 4, pose.center.x + bounds.size.w / 5, bounds.size.h / 2);
  GPoint point = GPoint(event->x, event->y);
  if (grect_contains_point(&mic, &point)) prv_start_dictation();
}
#endif

static void prv_quick_start(void *data) { prv_start_dictation(); }

static void prv_command(int slot) {
  prv_activity();
  if (s_state == StateSending || s_state == StateStarting) return;
  if (s_setup_needed) {
    prv_show(StateFail, "Set up VoiceHook on your phone first");
    return;
  }
  prv_send(NULL, slot);
}

static void prv_up_multi(ClickRecognizerRef recognizer, void *context) {
  prv_command(click_number_of_clicks_counted(recognizer) >= 2 ? SLOT_UP_DOUBLE : SLOT_UP_SINGLE);
}
static void prv_down_multi(ClickRecognizerRef recognizer, void *context) {
  prv_command(click_number_of_clicks_counted(recognizer) >= 2 ? SLOT_DOWN_DOUBLE : SLOT_DOWN_SINGLE);
}
static void prv_up_hold(ClickRecognizerRef recognizer, void *context) { prv_command(SLOT_UP_HOLD); }
static void prv_down_hold(ClickRecognizerRef recognizer, void *context) { prv_command(SLOT_DOWN_HOLD); }

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

  s_canvas = layer_create(bounds);
  layer_set_update_proc(s_canvas, prv_canvas_update);
  layer_add_child(root, s_canvas);

  int message_y = bounds.size.h * MESSAGE_Y_PERCENT / 100;
  int inset = PBL_IF_ROUND_ELSE(bounds.size.w / 7, 10);
  s_message_layer = text_layer_create(GRect(inset, message_y, bounds.size.w - 2 * inset, bounds.size.h - message_y - 6));
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
  prv_free_confirm();
}

static void prv_init(void) {
  srand(time(NULL));
  s_quick_launch = launch_reason() == APP_LAUNCH_QUICK_LAUNCH;
  if (persist_exists(PersistUpLabel)) persist_read_string(PersistUpLabel, s_up_label, LABEL_MAX);
  if (persist_exists(PersistDownLabel)) persist_read_string(PersistDownLabel, s_down_label, LABEL_MAX);

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_outbox_failed(prv_outbox_failed);
  app_message_open(dict_calc_buffer_size(4, sizeof(int32_t), WIRE_MESSAGE_MAX + 1, LABEL_MAX, LABEL_MAX), DICTATION_BUFFER + 64);

  s_dictation = dictation_session_create(DICTATION_BUFFER, prv_dictation, NULL);
  dictation_session_enable_confirmation(s_dictation, true);
  dictation_session_enable_error_dialogs(s_dictation, true);

  s_window = window_create();
  window_set_click_config_provider(s_window, prv_click_config);
  window_set_window_handlers(s_window, (WindowHandlers) { .load = prv_window_load, .unload = prv_window_unload });
  window_stack_push(s_window, true);
  prv_activity();
  if (s_quick_launch) app_timer_register(300, prv_quick_start, NULL);
#if defined(_PBL_API_EXISTS_touch_service_subscribe)
  if (touch_service_is_enabled()) touch_service_subscribe(prv_touch, NULL);
#endif
}

static void prv_deinit(void) {
#if defined(_PBL_API_EXISTS_touch_service_subscribe)
  touch_service_unsubscribe();
#endif
  prv_cancel(&s_frame_timer);
  prv_cancel(&s_reset_timer);
  prv_cancel(&s_timeout_timer);
  prv_cancel(&s_idle_timer);
  dictation_session_destroy(s_dictation);
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
