
#include <pebble.h>
#include <pebble-events/pebble-events.h>
#include <pebble-app-ready-service/pebble-app-ready-service.h>

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/* Various useful time intervals expressed in seconds. */
const time_t kOneMinute  = 60;
const time_t kOneHour    = 60 * 60;
const time_t kOneDay     = 60 * 60 * 24;
const time_t kHalfMinute = 60 / 2;
const time_t kHalfHour   = 60 * 60 / 2;
const time_t kHalfDay    = 60 * 60 * 24 / 2;
const time_t kSecondsMark = 45;
const time_t kMinutesMark = 45 * 60;
const time_t kHoursMark   = 18 * 60 * 60;

const uint16_t kMaxItemDisplay = 999;

// --------------------------------------------------------------------------
// Globals
// --------------------------------------------------------------------------

typedef struct StudySummary {
    uint16_t lesson_count;
    uint16_t review_count;
    int32_t epoch_hour;
    int32_t forecast_length;
    uint8_t* forecast;
} StudySummary;

Window* s_main_screen;
Window* s_load_screen;
Window* s_message_screen;
StudySummary s_summary;
AppTimer* s_refresh_timer;

static char s_scratch_text_buffer[64];
static char s_loading_text_buffer[128];
static char s_message_text_buffer[128];
static GColor s_message_fill_color;
static GColor s_message_text_color;
static AppLaunchReason s_launch_reason;
static EventHandle s_app_message_event_handle;

// --------------------------------------------------------------------------
// Fonts, Text, Colors, and Layout
// --------------------------------------------------------------------------

typedef struct MFont {
    GFont regular;
    GFont bold;
    uint8_t ascender; // from top of em-box to baseline.
    uint8_t cap_height; // from top of capitals to baseline.
} MFont;

MFont s_gothic_14;
MFont s_gothic_18;
MFont s_gothic_24;
MFont s_gothic_28;
GTextAttributes* s_layout_attributes = NULL;

static void init_font(MFont* font, const char* regular, const char* bold, uint16_t ascender, uint16_t cap_height) {
    font->regular = fonts_get_system_font(regular);
    font->bold    = fonts_get_system_font(bold);
    font->ascender = ascender;
    font->cap_height = cap_height;
}

static void init_fonts() {
    init_font(&s_gothic_14, FONT_KEY_GOTHIC_14, FONT_KEY_GOTHIC_14_BOLD, 5, 9);
    init_font(&s_gothic_18, FONT_KEY_GOTHIC_18, FONT_KEY_GOTHIC_18_BOLD, 7, 11);
    init_font(&s_gothic_24, FONT_KEY_GOTHIC_24, FONT_KEY_GOTHIC_24_BOLD, 10, 14);
    init_font(&s_gothic_28, FONT_KEY_GOTHIC_28, FONT_KEY_GOTHIC_28_BOLD, 10, 18);
    s_layout_attributes = graphics_text_attributes_create();
    graphics_text_attributes_enable_screen_text_flow(s_layout_attributes, 10);
}

static const GColor kMainWindowColor   = {.argb = PBL_IF_COLOR_ELSE(GColorLightGrayARGB8,      GColorBlackARGB8)};
static const GColor kLessonsBoxColor   = {.argb = PBL_IF_COLOR_ELSE(GColorFashionMagentaARGB8, GColorWhiteARGB8)};
static const GColor kReviewsBoxColor   = {.argb = PBL_IF_COLOR_ELSE(GColorVividCeruleanARGB8,  GColorWhiteARGB8)};
static const GColor kValueTextColor    = {.argb = PBL_IF_COLOR_ELSE(GColorWhiteARGB8,          GColorBlackARGB8)};
static const GColor kLabelInsetColor   = {.argb = PBL_IF_COLOR_ELSE(GColorWhiteARGB8,          GColorWhiteARGB8)};
static const GColor kLabelTextColor    = {.argb = PBL_IF_COLOR_ELSE(GColorBlackARGB8,          GColorBlackARGB8)};
static const GColor kForecastBoxColor  = {.argb = PBL_IF_COLOR_ELSE(GColorWhiteARGB8,          GColorWhiteARGB8)};
static const GColor kForecastTextColor = {.argb = PBL_IF_COLOR_ELSE(GColorBlackARGB8,          GColorBlackARGB8)};
static const GColor kErrorScreenColor  = {.argb = PBL_IF_COLOR_ELSE(GColorFollyARGB8,          GColorWhiteARGB8)};
static const GColor kErrorTextColor    = {.argb = PBL_IF_COLOR_ELSE(GColorWhiteARGB8,          GColorBlackARGB8)};
static const GColor kConfigScreenColor = {.argb = PBL_IF_COLOR_ELSE(GColorBlueARGB8,           GColorWhiteARGB8)};
static const GColor kConfigTextColor   = {.argb = PBL_IF_COLOR_ELSE(GColorWhiteARGB8,          GColorBlackARGB8)};
static const int16_t kBoxCornerRadius = 5;
static const int16_t kBoxStrokeWidth  = 2;
static const int16_t kBoxSpacing = 2;
static const MFont* kLoadScreenFont = &s_gothic_18;
static const MFont* kMessageScreenFont = &s_gothic_18;
static const MFont* kValueFont = &s_gothic_28;
static const MFont* kLabelFont = &s_gothic_14;
static const MFont* kForecastHeadingFont = &s_gothic_14;
static const MFont* kForecastRowFont = &s_gothic_18;
static const MFont* kNoForecastFont = &s_gothic_24;
static const char const* kLoadScreenDefaultText = "TabiTabi";
static const char const* kLessonsLabelText = "Lessons";
static const char const* kReviewsLabelText = "Reviews";
static const char const* kDayLabel[] = { "Today", "Tomorrow" };
static const char const* kEmptyForecastText = "No reviews in your 24 hour forecast.";

static const GEdgeInsets kTextScreenInsets = {
    .top = 10, .left = 10, .right = 10
};

#if defined(PBL_ROUND)
#else
#endif

// -----------------------------------------------------------------------------
//
// -----------------------------------------------------------------------------

static void draw_text_screen(Layer* layer, GContext* ctx, const char* text, GFont font) {

    GRect box = layer_get_bounds(layer);
    graphics_fill_rect(ctx, box, 0, GCornerNone);

    box = grect_inset(box, kTextScreenInsets);
    GTextOverflowMode overflow = GTextOverflowModeWordWrap;
    GTextAlignment alignment = GTextAlignmentCenter;
    GSize size = graphics_text_layout_get_content_size(
        text, font, box, overflow, alignment);
    box.origin.y = (box.size.h - size.h) / 2;

    graphics_draw_text(ctx, text, font, box, overflow, alignment, s_layout_attributes);
}

// -----------------------------------------------------------------------------
// Load Screen functions
// -----------------------------------------------------------------------------

static void draw_loading_screen(Layer* layer, GContext* ctx) {
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_context_set_fill_color(ctx, GColorWhite);
    draw_text_screen(layer, ctx, s_loading_text_buffer, kLoadScreenFont->bold);
}

static void load_loading_screen(Window* window) {
    Layer* layer = window_get_root_layer(window);
    layer_set_update_proc(layer, &draw_loading_screen);
}

static void unload_loading_screen(Window* window) {
}

Window* create_loading_screen() {
    Window* window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = load_loading_screen,
        .unload = unload_loading_screen,
    });
    return window;
}

// -----------------------------------------------------------------------------
// Result Screen functions
// -----------------------------------------------------------------------------

static void draw_message_screen(Layer* layer, GContext* ctx) {
    graphics_context_set_fill_color(ctx, s_message_fill_color);
    graphics_context_set_text_color(ctx, s_message_text_color);
    draw_text_screen(layer, ctx, s_message_text_buffer, kMessageScreenFont->bold);
}

static void load_message_screen(Window* window) {
    Layer* layer = window_get_root_layer(window);
    layer_set_update_proc(layer, &draw_message_screen);
}

static void unload_message_screen(Window* window) {
}

Window* create_message_screen() {
    Window* window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = load_message_screen,
        .unload = unload_message_screen,
    });
    return window;
}

static void show_error_screen(const char* message) {
    strncpy(s_message_text_buffer, message, sizeof s_message_text_buffer);
    s_message_fill_color = kErrorScreenColor;
    s_message_text_color = kErrorTextColor;
    if (!window_stack_contains_window(s_message_screen)) {
        window_stack_push(s_message_screen, true);
    }
    window_stack_remove(s_load_screen, false);
}

// -----------------------------------------------------------------------------
// Main Screen functions
// -----------------------------------------------------------------------------

static void update_schedule(StudySummary* q) {
    int32_t elapsedHours = time(NULL) / kOneHour - q->epoch_hour;
    int32_t dest = 0;
    for (int k = 0; k < q->forecast_length; k += 2) {
        int hourOffset = q->forecast[k];
        int subjectCount = q->forecast[k+1];
        if (hourOffset <= elapsedHours) {
            q->review_count += subjectCount;
        } else {
            q->forecast[dest++] = hourOffset - elapsedHours;
            q->forecast[dest++] = subjectCount;
        }
    }
    q->forecast_length = dest;
    q->epoch_hour += elapsedHours;

    Layer* layer = window_get_root_layer(s_main_screen);
    layer_mark_dirty(layer);
}

static void refresh_timer_callback(void* data) {
    s_refresh_timer = NULL;
    update_schedule(&s_summary);
}

static inline time_t first_of(time_t a, time_t b) {
    return a < b ? a : b;
}

static void draw_available(GContext* ctx, GRect* box, GColor bg, const char* label, const char* value) {

    GRect ibox;
    GRect tbox;
    const MFont* labelFont = kLabelFont;
    const MFont* valueFont = kValueFont;

    int labelMargin = labelFont->ascender / 2;
    int valueMargin = valueFont->ascender / 2;
    int labelHeight = labelFont->cap_height + 2 * labelMargin;
    int valueHeight = valueFont->cap_height + 2 * valueMargin;

    box->size.h = labelHeight + valueHeight + kBoxStrokeWidth;

    /* Fill the whole box. */
    graphics_context_set_fill_color(ctx, bg);
    graphics_fill_rect(ctx, *box, kBoxCornerRadius, GCornersAll);

    /* Fill the label inset box. */
    ibox.origin.x = box->origin.x + kBoxStrokeWidth;
    ibox.origin.y = box->origin.y + valueHeight;
    ibox.size.w = box->size.w - 2 * kBoxStrokeWidth;
    ibox.size.h = labelHeight;
    graphics_context_set_fill_color(ctx, kLabelInsetColor);
    graphics_fill_rect(ctx, ibox, kBoxCornerRadius - kBoxStrokeWidth, GCornersBottom);

    /* Draw the value. */
    tbox.origin.x = box->origin.x;
    tbox.origin.y = box->origin.y + valueMargin - valueFont->ascender;
    tbox.size.w = ibox.size.w;
    tbox.size.h = valueFont->ascender + valueFont->cap_height;
    graphics_context_set_text_color(ctx, kValueTextColor);
    graphics_draw_text(ctx, value, valueFont->bold, tbox, GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);

    /* Draw the label. */
    tbox.origin.x = ibox.origin.x;
    tbox.origin.y = ibox.origin.y + labelMargin - labelFont->ascender;
    tbox.size.w = box->size.w;
    tbox.size.h = labelFont->ascender + labelFont->cap_height;
    graphics_context_set_text_color(ctx, kLabelTextColor);
    graphics_draw_text(ctx, label, labelFont->regular, tbox, GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
}

static GRect draw_forecast_row(GContext* ctx, GRect box, time_t time, uint16_t count, uint16_t total) {

    const MFont* font = kForecastRowFont;
    struct tm* local = localtime(&time);
    char* buffer = s_scratch_text_buffer;
    size_t maxsize = sizeof s_scratch_text_buffer;
    GRect rbox = box;
    rbox.origin.x += font->ascender;
    rbox.size.w -= 2 * font->ascender;
    rbox.size.h = font->ascender + font->cap_height;
    GRect tbox = rbox;
    
    /* 00 01 ... 11 12 13 14 ... 23
       12  1 ... 11 12  1  2 ... 11 */
    if (clock_is_24h_style()) {
        snprintf(buffer, maxsize, "%02d:%02d", local->tm_hour, local->tm_min);
    } else {
        int h = local->tm_hour % 12;
        if (h == 0) h = 12;
        char m = (local->tm_hour < 12) ? 'a' : 'p';
        snprintf(buffer, maxsize, "%u%c", h, m);
    }
    APP_LOG(APP_LOG_LEVEL_DEBUG, "%s +%u =%u", buffer, count, total);
    graphics_draw_text(ctx, buffer, font->regular, tbox, GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);

    snprintf(buffer, maxsize, "%u", total);
    graphics_draw_text(ctx, buffer, font->regular, tbox, GTextOverflowModeWordWrap, GTextAlignmentRight, NULL);

    GSize totalSize = graphics_text_layout_get_content_size(" |9999", font->regular, box, GTextOverflowModeWordWrap, GTextAlignmentRight);
    tbox.size.w -= totalSize.w;
    snprintf(buffer, maxsize, "+%u", count);
    graphics_draw_text(ctx, buffer, font->regular, tbox, GTextOverflowModeWordWrap, GTextAlignmentRight, NULL);
    
    box.origin.y += rbox.size.h;
    box.size.h -= rbox.size.h;
    return box;
}

static void draw_main_screen(Layer* layer, GContext* ctx) {

    char* buffer = s_scratch_text_buffer;
    char* end = buffer + sizeof s_scratch_text_buffer;
    StudySummary* q = &s_summary;
    GRect bounds = layer_get_bounds(layer);
    GRect box;
    GRect tbox;

    /* Schedule a refresh for the first review in the forecast. */
    if (s_refresh_timer) {
        app_timer_cancel(s_refresh_timer);
        s_refresh_timer = NULL;
    }
    if (q->forecast_length > 0) {
        time_t now = time(NULL); // {epoch seconds}
        time_t tomorrow = time_start_of_today() + kOneDay;
        time_t nextForecast = (q->epoch_hour + q->forecast[0]) * kOneHour;
        time_t refreshAt = first_of(tomorrow, nextForecast);
        time_t refreshIn = refreshAt - now;
        APP_LOG(APP_LOG_LEVEL_DEBUG, "refresh in %02lu:%02lu:%02lu, at %02lu:%02lu:%02luZ\n",
             refreshIn / 3600,       (refreshIn / 60) % 60, refreshIn % 60,
            (refreshAt / 3600) % 24, (refreshAt / 60) % 60, refreshAt % 60);
        s_refresh_timer = app_timer_register(refreshIn * 1000, &refresh_timer_callback, NULL);
    }

    /* Clear the layer. */
    graphics_context_set_fill_color(ctx, kMainWindowColor);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    /* Draw the available lessons box. */
    box.origin.x = kBoxSpacing;
    box.origin.y = kBoxSpacing;
    box.size.w = bounds.size.w / 2 - kBoxSpacing - kBoxSpacing/2;
    snprintf(buffer, end - buffer, "%u", q->lesson_count);
    draw_available(ctx, &box, kLessonsBoxColor, kLessonsLabelText, buffer);

    /* Draw the available reviews box. */
    box.origin.x = bounds.size.w / 2 + kBoxSpacing/2;
    snprintf(buffer, end - buffer, "%u", q->review_count);
    draw_available(ctx, &box, kReviewsBoxColor, kReviewsLabelText, buffer);

    /* Draw the box for the review forecast. */
    box.origin.x = kBoxSpacing;
    box.origin.y += box.size.h + kBoxSpacing;
    box.size.w = bounds.size.w - 2 * kBoxSpacing;
    box.size.h = bounds.size.h - kBoxSpacing - box.origin.y;
    graphics_context_set_fill_color(ctx, kForecastBoxColor);
    graphics_fill_rect(ctx, box, kBoxCornerRadius, GCornersAll);

    const MFont* headingFont = kForecastHeadingFont;
    uint16_t headingMargin = headingFont->ascender / 2;
    box.origin.x += headingMargin;
    box.origin.y += 0;
    box.size.w -= 2 * headingMargin;
    box.size.h -= 2 * 0;
    graphics_context_set_text_color(ctx, kForecastTextColor);

    if (q->forecast_length == 0) {
        const char* text = kEmptyForecastText;
        const MFont* font = kNoForecastFont;
        int margin = font->ascender;
        tbox.origin.x = box.origin.x + margin;
        tbox.origin.y = box.origin.y;
        tbox.size.w = box.size.w - 2 * margin;
        tbox.size.h = box.size.h - 2;
        graphics_draw_text(ctx, text, font->bold, tbox, GTextOverflowModeFill, GTextAlignmentCenter, NULL);
        return;
    }

    const MFont* rowFont = kForecastRowFont;
    uint16_t headingHeight = headingFont->ascender + headingFont->cap_height;
    uint16_t rowHeight = rowFont->ascender + rowFont->cap_height;

    int day = -1;
    uint16_t totalReviews = q->review_count;
    time_t endOfDay = time_start_of_today();
    for (int k = 0; k < q->forecast_length && day < 2; k += 2) {
        time_t rowTime = (q->epoch_hour + q->forecast[k]) * kOneHour;
        uint16_t rowReviews = q->forecast[k+1];
        totalReviews += rowReviews;
        if (rowTime >= endOfDay) {
            if (box.size.h < headingHeight) {
                break;
            }
            while (rowTime >= endOfDay) {
                day += 1;
                endOfDay += kOneDay;
            }
            tbox = box;
            APP_LOG(APP_LOG_LEVEL_DEBUG, "%s", kDayLabel[day]);
            graphics_draw_text(ctx, kDayLabel[day], headingFont->bold, tbox, GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
            box.origin.y += headingHeight;
            box.size.h -= headingHeight;
        }
        if (box.size.h < rowHeight) {
            break;
        }
        box = draw_forecast_row(ctx, box, rowTime, rowReviews, totalReviews);
    }

}

static void load_main_screen(Window* window) {
    Layer* layer = window_get_root_layer(window);
    layer_set_update_proc(layer, &draw_main_screen);
}

static void unload_main_screen(Window* window) {
}

Window* create_main_screen() {
    Window* window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = load_main_screen,
        .unload = unload_main_screen,
    });
    return window;
}


// -----------------------------------------------------------------------------
// Event Handlers
// -----------------------------------------------------------------------------

void success_auto_close(void* context) {
    exit_reason_set(APP_EXIT_ACTION_PERFORMED_SUCCESSFULLY);
    window_stack_pop_all(true);
}

static void app_ready(void* context) {
    if (s_launch_reason == APP_LAUNCH_TIMELINE_ACTION
     || s_launch_reason == APP_LAUNCH_QUICK_LAUNCH
     || s_launch_reason == APP_LAUNCH_USER
     || s_launch_reason == APP_LAUNCH_SYSTEM) // The aplite platform always launches with this code.
    {
        /* If the user has launched the app, tell the JS side to update the
           study schedule. */
        DictionaryIterator* out_iter;
        AppMessageResult result = app_message_outbox_begin(&out_iter);
        if (result != APP_MSG_OK) {
            APP_LOG(APP_LOG_LEVEL_ERROR, "Error preparing the outbox: %d", (int)result);
            return;
        }

        int value = 1;
        dict_write_int(out_iter, MESSAGE_KEY_REFRESH, &value, sizeof(int), true);
        result = app_message_outbox_send();

        if (result != APP_MSG_OK) {
            show_error_screen("I've fallen and I can't get up.");
        } else {
            APP_LOG(APP_LOG_LEVEL_DEBUG, "Requested update.");
        }

    } else {
        /* If the app is launched for any other reason, particular if it is
           launched in order to configure the settings, do not initiate an
           update. */
    }

}

static void app_timeout(void* context) {
    strncpy(s_message_text_buffer, "Host unavailable.", sizeof s_message_text_buffer);
    window_set_background_color(s_message_screen, GColorFolly);
    s_message_text_color = GColorWhite;
    window_stack_push(s_message_screen, true);
    window_stack_remove(s_load_screen, false);
}

#if PBL_API_EXISTS(app_glance_reload)

static const char* glance_slice_subtitle(int lessons, int reviews) {
    snprintf(s_scratch_text_buffer, ARRAY_LENGTH(s_scratch_text_buffer),
        "L:%d R:%d", lessons, reviews);
    return s_scratch_text_buffer;
}

static void refresh_app_glance(AppGlanceReloadSession* session, size_t limit, void* context) {

    StudySummary* q = (StudySummary*)context;
    int baseEpochHour = q->epoch_hour;
    uint16_t reviewCount = q->review_count;

    /* We will create one slice for the currently available reviews, and one
       slice for each upcoming review in the schedule, but limit the total
       slices as indicated by the system. */
    size_t sliceCount = 1 + q->forecast_length / 2;
    if (sliceCount > limit) {
        sliceCount = limit;
    }

    AppGlanceSlice slice;
    slice.layout.icon = PUBLISHED_ID_ICON;
    slice.layout.subtitle_template_string = glance_slice_subtitle(q->lesson_count, reviewCount);
    slice.expiration_time = APP_GLANCE_SLICE_NO_EXPIRATION;

    for (size_t k = 0; k < sliceCount - 1; ++k) {
        int epochHour = q->forecast[k * 2];
        int itemCount = q->forecast[k * 2 + 1];
        slice.expiration_time = (baseEpochHour + epochHour) * kOneHour;
        const AppGlanceResult result = app_glance_add_slice(session, slice);
        if (result != APP_GLANCE_RESULT_SUCCESS) {
            APP_LOG(APP_LOG_LEVEL_ERROR, "AppGlance Error: %d", result);
        }

        reviewCount += itemCount;
        slice.layout.subtitle_template_string = glance_slice_subtitle(q->lesson_count, reviewCount);
    }

    slice.expiration_time = APP_GLANCE_SLICE_NO_EXPIRATION;
    const AppGlanceResult result = app_glance_add_slice(session, slice);
    if (result != APP_GLANCE_RESULT_SUCCESS) {
        APP_LOG(APP_LOG_LEVEL_ERROR, "AppGlance Error: %d", result);
    }

}

#endif // PBL_API_EXISTS(app_glance_reload)

static void message_received(DictionaryIterator* received, void* context) {

    StudySummary* q = &s_summary;

    Tuple* t = dict_find(received, MESSAGE_KEY_CONFIGURE);
    if (t) {
        if (t->type == TUPLE_CSTRING) {
            strncpy(s_message_text_buffer, t->value->cstring, sizeof s_message_text_buffer);
            s_message_fill_color = kConfigScreenColor;
            s_message_text_color = kConfigTextColor;
            if (!window_stack_contains_window(s_message_screen)) {
                window_stack_push(s_message_screen, true);
            }
            window_stack_remove(s_load_screen, false);

        } else if (t->type == TUPLE_INT && t->value->int32 == 0) {
            window_stack_remove(s_message_screen, true);
        }
    }

    t = dict_find(received, MESSAGE_KEY_PROGRESS);
    if (t && t->type == TUPLE_CSTRING) {
        strncpy(s_loading_text_buffer, t->value->cstring, sizeof s_loading_text_buffer);
        layer_mark_dirty(window_get_root_layer(s_load_screen));
        window_stack_remove(s_message_screen, true);
        if (!window_stack_contains_window(s_load_screen)) {
            window_stack_push(s_load_screen, true);
        }
    }

    t = dict_find(received, MESSAGE_KEY_EPOCH_HOUR);
    if (t && t->type == TUPLE_INT) {
        q->epoch_hour = t->value->int32;
    }
    
    t = dict_find(received, MESSAGE_KEY_LESSON_COUNT);
    if (t && t->type == TUPLE_INT) {
        q->lesson_count = t->value->int32;
    }
    
    t = dict_find(received, MESSAGE_KEY_REVIEW_COUNT);
    if (t && t->type == TUPLE_INT) {
        q->review_count = t->value->int32;
    }
    
    t = dict_find(received, MESSAGE_KEY_REVIEW_FORECAST);
    if (t && t->type == TUPLE_BYTE_ARRAY) {
        q->forecast_length = t->length;
        q->forecast = realloc(q->forecast, t->length);
        memcpy(q->forecast, t->value->data, t->length);
    }

    t = dict_find(received, MESSAGE_KEY_SUCCESS);
    if (t && t->type == TUPLE_INT && t->value->int32 != 0) {
#if PBL_API_EXISTS(app_glance_reload)
        app_glance_reload(refresh_app_glance, &s_summary);
#endif
        if (!window_stack_contains_window(s_main_screen)) {
            window_stack_push(s_main_screen, false);
        }
        window_stack_remove(s_load_screen, true);
        window_stack_remove(s_message_screen, true);
    }

    t = dict_find(received, MESSAGE_KEY_ERROR);
    if (t && t->type == TUPLE_CSTRING) {
        show_error_screen(t->value->cstring);
    }

}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

int main() {

    init_fonts();

    strncpy(s_loading_text_buffer, kLoadScreenDefaultText, sizeof s_loading_text_buffer);
    memset(&s_summary, 0, sizeof s_summary);

    /*
     * 0 APP_LAUNCH_SYSTEM           App launched by the system
     * 1 APP_LAUNCH_USER             App launched by user selection in launcher menu
     * 2 APP_LAUNCH_PHONE            App launched by mobile or companion app
     * 3 APP_LAUNCH_WAKEUP           App launched by wakeup event
     * 4 APP_LAUNCH_WORKER           App launched by worker calling worker_launch_app()
     * 5 APP_LAUNCH_QUICK_LAUNCH     App launched by user using quick launch
     * 6 APP_LAUNCH_TIMELINE_ACTION  App launched by user opening it from a pin
     * 7 APP_LAUNCH_SMARTSTRAP       App launched by a smartstrap
     */
    s_launch_reason = launch_reason();
    APP_LOG(APP_LOG_LEVEL_DEBUG, "launch reason #%d", s_launch_reason);

    s_main_screen = create_main_screen();
    s_load_screen = create_loading_screen();
    s_message_screen = create_message_screen();

    window_stack_push(s_load_screen, true);

    app_ready_service_subscribe((AppReadyHandlers){
        .ready = app_ready,
        .timeout = app_timeout
    }, NULL);

    events_app_message_request_inbox_size(1024);
    events_app_message_request_outbox_size(32);
    s_app_message_event_handle = events_app_message_register_inbox_received(&message_received, NULL);
    events_app_message_open();

    app_event_loop();

    window_destroy(s_load_screen);
    window_destroy(s_message_screen);
    window_destroy(s_main_screen);

}

