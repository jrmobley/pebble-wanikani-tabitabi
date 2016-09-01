
#include <pebble.h>
#include <pebble-events/pebble-events.h>

Window* s_load_screen;
Window* s_result_screen;
static char s_result_text[256];
static GColor s_result_text_color;
static AppLaunchReason s_launch_reason;
static EventHandle s_app_message_event_handle;

static Window* create_load_screen();
static Window* create_result_screen();

void success_auto_close(void* context) {
    exit_reason_set(APP_EXIT_ACTION_PERFORMED_SUCCESSFULLY);
    window_stack_pop_all(true);
}

static void message_received(DictionaryIterator* received, void* context) {

    Tuple* t = dict_find(received, MESSAGE_KEY_PUBLIC_API_KEY);
    if (t && t->type == TUPLE_INT) {
        strncpy(s_result_text, "Please provide your Public API Key in the settings.", sizeof s_result_text);
        window_set_background_color(s_result_screen, GColorBlue);
        s_result_text_color = GColorWhite;
        window_stack_push(s_result_screen, true);
        window_stack_remove(s_load_screen, false);
    }

    t = dict_find(received, MESSAGE_KEY_SUCCESS);
    if (t) {
        strncpy(s_result_text, t->value->cstring, sizeof s_result_text);
        window_set_background_color(s_result_screen, GColorWhite);
        s_result_text_color = GColorBlack;
        window_stack_push(s_result_screen, true);
        window_stack_remove(s_load_screen, false);
        app_timer_register(2000, &success_auto_close, NULL);
    }

    t = dict_find(received, MESSAGE_KEY_ERROR);
    if (t && t->type == TUPLE_CSTRING) {
        strncpy(s_result_text, t->value->cstring, sizeof s_result_text);
        window_set_background_color(s_result_screen, GColorFolly);
        s_result_text_color = GColorWhite;
        window_stack_push(s_result_screen, true);
        window_stack_remove(s_load_screen, false);
    }

}

int main() {

    s_load_screen = create_load_screen();
    window_stack_push(s_load_screen, true);

    s_result_screen = create_result_screen();

    events_app_message_request_inbox_size(2048);
    events_app_message_request_outbox_size(32);
    s_app_message_event_handle = events_app_message_register_inbox_received(&message_received, NULL);
    events_app_message_open();

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

    app_event_loop();

    window_destroy(s_load_screen);
    window_destroy(s_result_screen);

}

// -----------------------------------------------------------------------------
// Load Screen functions
// -----------------------------------------------------------------------------

static void draw_load_screen(Layer* layer, GContext* ctx) {

    GRect bounds = layer_get_bounds(layer);
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    const char* text = "kangaete imasu";
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
    GRect box = layer_get_bounds(layer);
    GTextOverflowMode overflow = GTextOverflowModeWordWrap;
    GTextAlignment alignment = GTextAlignmentCenter;

    GSize size = graphics_text_layout_get_content_size(
        text, font, box, overflow, alignment);
    box.origin.y = (box.size.h - size.h) / 2;

    graphics_draw_text(ctx, text, font, box, overflow, alignment, NULL);
}

static void load_load_screen(Window* window) {

    Layer* layer = window_get_root_layer(window);
    layer_set_update_proc(layer, &draw_load_screen);
}

static void unload_load_screen(Window* window) {
}

Window* create_load_screen() {
    Window* window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = load_load_screen,
        .unload = unload_load_screen,
    });
    return window;
}

// -----------------------------------------------------------------------------
// Result Screen functions
// -----------------------------------------------------------------------------

static TextLayer* s_result_text_layer = NULL;

static void load_result_screen(Window* window) {
    Layer* window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    const GEdgeInsets insets = {
        .top = 10, .left = 10, .right = 10
    };

    s_result_text_layer = text_layer_create(grect_inset(bounds, insets));
    text_layer_set_text_alignment(s_result_text_layer, GTextAlignmentCenter);
    text_layer_set_overflow_mode(s_result_text_layer, GTextOverflowModeWordWrap);
    text_layer_set_font(s_result_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_text_color(s_result_text_layer, GColorBlack);
    text_layer_set_background_color(s_result_text_layer, GColorClear);

    text_layer_set_text(s_result_text_layer, s_result_text);

#if defined(PBL_ROUND)
    text_layer_enable_screen_text_flow_and_paging(s_result_text_layer, 3);
#endif

    layer_add_child(window_layer, text_layer_get_layer(s_result_text_layer));
}

static void unload_result_screen(Window* window) {
    text_layer_destroy(s_result_text_layer);
    s_result_text_layer = NULL;
}

Window* create_result_screen() {
    Window* window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = load_result_screen,
        .unload = unload_result_screen,
    });
    return window;
}
