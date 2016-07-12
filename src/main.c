
#include <pebble.h>

enum {
    ErrorNoKey = 1,
    ErrorNoUser = 2,
};

const time_t kSlotSize   = 60 * 15;
const time_t kOneMinute  = 60;
const time_t kOneHour    = 60 * 60;
const time_t kOneDay     = 60 * 60 * 24;
const time_t kHalfMinute = 60 / 2;
const time_t kHalfHour   = 60 * 60 / 2;
const time_t kHalfDay    = 60 * 60 * 24 / 2;
const time_t kSecondsMark = 45;
const time_t kMinutesMark = 45 * 60;
const time_t kHoursMark   = 18 * 60 * 60;
const uint16_t kMaxItemDisplay = 42; // ha ha ha

const char* kLoadMessages[] = {
    "What does the Crabigator say?",
    "A Crabigator says what?",
    "Burning the turtles...",
    "Counting turtles...",
    "Consulting the Crabigator...",
    "Checking your schedule...",
};

typedef struct {
    char textBuffer[128];
    const char* lessonsAvailable;
    const char* reviewsAvailable;
    const char* reviewsAvailableNextHour;
    const char* reviewsAvailableNextDay;
    const char* nextReview;
} DisplayData;

typedef struct {
    uint16_t lessonsAvailable;
    uint16_t reviewsAvailable;
    time_t nextReviewDate;
    uint16_t reviewsAvailableNextHour;
    uint16_t reviewsAvailableNextDay;
    uint16_t scheduleLength;
    uint8_t* schedule;
} StudyQueue;

Window* theLoadScreen;
Window* theErrorScreen;
Window* theMainScreen;
StudyQueue theStudyQueue;
DisplayData theDisplayData;
AppTimer* theRefreshTimer;
int32_t theErrorCode;
const char* theLoadMessage;

static Window* createLoadScreen();
static Window* createMainScreen();
static void refreshMainScreen();
static void setErrorCode(int32_t errorCode);

static void refreshTimerCallback(void* data) {
    theRefreshTimer = NULL;
    refreshMainScreen();
}

static inline uint32_t firstOf(uint32_t a, uint32_t b) {
    return a < b ? a : b;
}

static void refreshMainScreen() {

    DisplayData* display = &theDisplayData;
    char* buffer = display->textBuffer;
    char* end = buffer + sizeof display->textBuffer;
    uint32_t refresh = 0;

    /* Since we may be working with rather old StudyQueue data (since the
       data fetch at app launch), the first operation here is to scan through
       the schedule and calculate how the StudyQueue should look at the
       current time.  Of particular note is the treatment of next-day and
       next-hour figures.  To be consistent with the contents of the study
       queue data, we never include currently available reviews in these
       counts.  This is inconsistent with how the wanikani dashboard behaves
       when the page is left open. */

    StudyQueue q = {
        .lessonsAvailable = theStudyQueue.lessonsAvailable,
        .reviewsAvailable = theStudyQueue.reviewsAvailable,
        .nextReviewDate = theStudyQueue.nextReviewDate,
        .reviewsAvailableNextHour = 0,
        .reviewsAvailableNextDay = 0,
        .scheduleLength = theStudyQueue.scheduleLength,
        .schedule = theStudyQueue.schedule
    };

    time_t now = time(NULL);
    time_t span = (q.nextReviewDate > now) ? (q.nextReviewDate - now) : 0;
    int baseTimeSlot = q.nextReviewDate / kSlotSize;
    int currentTimeSlot = (now / kSlotSize) - baseTimeSlot;
    int nextHourSlot = currentTimeSlot + 4;
    int nextDaySlot = currentTimeSlot + 4*24;

    APP_LOG(APP_LOG_LEVEL_DEBUG, " %3d        %7d %5d %5d  %02lu:%02lu:%02lu",
        currentTimeSlot,
        theStudyQueue.reviewsAvailable,
        theStudyQueue.reviewsAvailableNextHour,
        theStudyQueue.reviewsAvailableNextDay,
        span / 3600, (span / 60) % 60, span % 60);
    APP_LOG(APP_LOG_LEVEL_DEBUG, "slot reviews  avail  <%3d  <%3d   refresh",
        nextHourSlot, nextDaySlot);

    for (int k = 0; k < q.scheduleLength; k += 2) {
        int timeSlot = q.schedule[k];
        int itemCount = q.schedule[k+1];
        static char debug[81];
        char* dp = debug;
        char* dend = dp + sizeof debug;

        dp += snprintf(dp, dend-dp, " %3d %7d", timeSlot, itemCount);

        if (timeSlot <= currentTimeSlot) {
            q.reviewsAvailable += itemCount;
            dp += snprintf(dp, dend-dp, " %6d", q.reviewsAvailable);
        } else {
            dp += snprintf(dp, dend-dp, "       ");
        }

        if (timeSlot > currentTimeSlot) {
            if (timeSlot <= nextHourSlot) {
                q.reviewsAvailableNextHour += itemCount;
                dp += snprintf(dp, dend-dp, " %5d", q.reviewsAvailableNextHour);
            } else {
                dp += snprintf(dp, dend-dp, "      ");
            }

            if (timeSlot <= nextDaySlot) {
                q.reviewsAvailableNextDay += itemCount;
                dp += snprintf(dp, dend-dp, " %5d", q.reviewsAvailableNextDay);
            } else {
                dp += snprintf(dp, dend-dp, "      ");
            }
        }

        /* When we see the first future review slot, calculate the refresh
           time interval until that review. */
        if (timeSlot > currentTimeSlot && refresh == 0) {
            refresh = (baseTimeSlot + timeSlot) * kSlotSize - now;
            dp += snprintf(dp, dend-dp, "  %02lu:%02lu:%02lu",
                refresh / 3600, (refresh / 60) % 60, refresh % 60);
        } else {
            dp += snprintf(dp, dend-dp, "         ");
        }

        *dp = '\0';
        APP_LOG(APP_LOG_LEVEL_DEBUG, debug);
    }

    /* Now that we have our updated StudyQueue, we can format the various
       values for display.  Everything except the next-review-date is
       straightforward. */

    display->lessonsAvailable = buffer;
    if (q.lessonsAvailable > kMaxItemDisplay) {
        buffer += 1 + snprintf(buffer, end - buffer, "%u+", kMaxItemDisplay);
    } else {
        buffer += 1 + snprintf(buffer, end - buffer, "%u", q.lessonsAvailable);
    }

    display->reviewsAvailable = buffer;
    if (q.reviewsAvailable > kMaxItemDisplay) {
        buffer += 1 + snprintf(buffer, end - buffer, "%u+", kMaxItemDisplay);
    } else {
        buffer += 1 + snprintf(buffer, end - buffer, "%u", q.reviewsAvailable);
    }

    display->reviewsAvailableNextHour = buffer;
    buffer += 1 + snprintf(buffer, end - buffer, "%u", q.reviewsAvailableNextHour);

    display->reviewsAvailableNextDay = buffer;
    buffer += 1 + snprintf(buffer, end - buffer, "%u", q.reviewsAvailableNextDay);

    /* To display the next-review-date, we want to express the span of time
       from now until then as an even number of the most appropriate time units.
       E.g. "10 minutes" or "1 hour".  Or, if reviews are currently available,
       we simply say that.  This is also where we calculate the time until the
       next display refresh.  This is when any of the displayed values will need
       to change, so the interval is dependent on what we are currently
       displaying. */

    display->nextReview = buffer;
    APP_LOG(APP_LOG_LEVEL_DEBUG, "next review in %02lu:%02lu:%02lu",
        span / 3600, (span / 60) % 60, span % 60);

    if (q.reviewsAvailable) {
        strncpy(buffer, "Available Now", end - buffer);
        /* Refresh was set above for the first future review slot so that we
           can update the counts at that time.  The cases below, for when
           there are no currently available reviews, will schedule a refresh
           for when the time-until-next-review needs to be updated. */

    } else if (span <= kSecondsMark) {
        refresh = 1;
        APP_LOG(APP_LOG_LEVEL_DEBUG, "review in %lus", span);
        buffer += 1 + snprintf(buffer, end - buffer, "%lu seconds", span);

    } else if (span <= kMinutesMark) {
        time_t nearestMinute = (span + kHalfMinute) / kOneMinute;
        time_t digitBumpIn = span - (nearestMinute * kOneMinute - kHalfMinute - 1);
        time_t unitBumpIn = span - kSecondsMark;
        refresh = firstOf(digitBumpIn, unitBumpIn);
        APP_LOG(APP_LOG_LEVEL_DEBUG,
            "review in %lum; digit bump in %lus; unit bump in %lus",
            nearestMinute, digitBumpIn, unitBumpIn);
        buffer += 1 + snprintf(buffer, end - buffer, "%lu %s",
            nearestMinute, (nearestMinute == 1) ? "minute" : "minutes");

    } else if (span <= kHoursMark) {
        time_t nearestHour = (span + kHalfHour) / kOneHour;
        time_t digitBumpIn = span - (nearestHour * kOneHour - kHalfHour - kOneMinute);
        time_t unitBumpIn = span - kMinutesMark;
        refresh = firstOf(digitBumpIn, digitBumpIn);
        APP_LOG(APP_LOG_LEVEL_DEBUG,
            "review in %luh; digit bump in %lus; unit bump in %lus",
            nearestHour, digitBumpIn, unitBumpIn);
        buffer += 1 + snprintf(buffer, end - buffer, "about %lu %s",
            nearestHour, (nearestHour == 1) ? "hour" : "hours");

    } else {
        time_t nearestDay = (span + kHalfDay) / kOneDay;
        time_t digitBumpIn = span - (nearestDay * kOneDay - kHalfDay - kOneHour);
        time_t unitBumpIn = span - kHoursMark;
        APP_LOG(APP_LOG_LEVEL_DEBUG,
            "review in %lud; digit bump in %lus; unit bump in %lus",
            nearestDay, digitBumpIn, unitBumpIn);
        buffer += 1 + snprintf(buffer, end - buffer, "about %lu %s",
            nearestDay, (nearestDay == 1) ? "day" : "days");
    }

    /* Finally, we can schedule the next refresh and tell the system to redraw
       the display. */

    if (theRefreshTimer) {
        app_timer_cancel(theRefreshTimer);
    }
    if (refresh) {
        APP_LOG(APP_LOG_LEVEL_DEBUG, "refresh in %02lu:%02lu:%02lu\n",
            refresh / 3600, (refresh / 60) % 60, refresh % 60);
        theRefreshTimer = app_timer_register(refresh * 1000, &refreshTimerCallback, NULL);
    }

    Layer* layer = window_get_root_layer(theMainScreen);
    layer_mark_dirty(layer);
}

#if PBL_API_EXISTS(app_glance_reload)

static const char* glanceSliceSubtitle(int lessons, int reviews) {
    snprintf(theDisplayData.textBuffer, ARRAY_LENGTH(theDisplayData.textBuffer),
        "L:%d R:%d", lessons, reviews);
    return theDisplayData.textBuffer;
}

static void refreshAppGlance(AppGlanceReloadSession* session, size_t limit, void* context) {

    StudyQueue* q = (StudyQueue*)context;
    int baseTimeSlot = q->nextReviewDate / kSlotSize;
    uint16_t reviewsAvailable = q->reviewsAvailable;

    /* We will create one slice for the currently available reviews, and one
       slice for each upcoming review in the schedule, but limit the total
       slices as indicated by the system. */
    size_t sliceCount = 1 + q->scheduleLength / 2;
    if (sliceCount > limit) {
        sliceCount = limit;
    }

    AppGlanceSlice slice;
    slice.layout.icon = RESOURCE_ID_GLANCE_ICON;
    slice.layout.subtitle_template_string = glanceSliceSubtitle(q->lessonsAvailable, reviewsAvailable);
    slice.expiration_time = APP_GLANCE_SLICE_NO_EXPIRATION;

    for (size_t k = 0; k < sliceCount - 1; ++k) {
        int timeSlot = q->schedule[k * 2];
        int itemCount = q->schedule[k * 2 + 1];
        slice.expiration_time = (baseTimeSlot + timeSlot) * kSlotSize;
        const AppGlanceResult result = app_glance_add_slice(session, slice);
        if (result != APP_GLANCE_RESULT_SUCCESS) {
            APP_LOG(APP_LOG_LEVEL_ERROR, "AppGlance Error: %d", result);
        }

        reviewsAvailable += itemCount;
        slice.layout.subtitle_template_string = glanceSliceSubtitle(q->lessonsAvailable, reviewsAvailable);
    }

    slice.expiration_time = APP_GLANCE_SLICE_NO_EXPIRATION;
    const AppGlanceResult result = app_glance_add_slice(session, slice);
    if (result != APP_GLANCE_RESULT_SUCCESS) {
        APP_LOG(APP_LOG_LEVEL_ERROR, "AppGlance Error: %d", result);
    }

}

#endif // PBL_API_EXISTS(app_glance_reload)

static void messageReceived(DictionaryIterator* received, void* context) {

    StudyQueue* q = &theStudyQueue;
    int32_t error = 0;

    for (Tuple* t = dict_read_first(received); t != NULL; t = dict_read_next(received)) {

        if (MESSAGE_KEY_ERROR == t->key) {
            error = t->value->int32;

        } else if (MESSAGE_KEY_LESSONS_AVAILABLE == t->key) {
            q->lessonsAvailable = t->value->int32;

        } else if (MESSAGE_KEY_REVIEWS_AVAILABLE == t->key) {
            q->reviewsAvailable = t->value->int32;

        } else if (MESSAGE_KEY_NEXT_REVIEW_DATE == t->key) {
            q->nextReviewDate = t->value->uint32;

        } else if (MESSAGE_KEY_REVIEWS_AVAILABLE_NEXT_HOUR == t->key) {
            q->reviewsAvailableNextHour = t->value->int32;

        } else if (MESSAGE_KEY_REVIEWS_AVAILABLE_NEXT_DAY == t->key) {
            q->reviewsAvailableNextDay = t->value->int32;

        } else if (MESSAGE_KEY_SCHEDULE == t->key && t->type == TUPLE_BYTE_ARRAY) {
            q->scheduleLength = t->length;
            q->schedule = realloc(q->schedule, t->length);
            memcpy(q->schedule, t->value->data, t->length);
        }
    }

    setErrorCode(error);
    if (!error) {
        refreshMainScreen();
        window_stack_remove(theLoadScreen, true);
    }
}

static void init() {

    srand(time(NULL));

    memset(&theStudyQueue, 0, sizeof theStudyQueue);
    theErrorScreen = NULL;
    theErrorCode = 0;

    theMainScreen = createMainScreen();
    window_stack_push(theMainScreen, false);

    theLoadScreen = createLoadScreen();
    window_stack_push(theLoadScreen, false);

    app_message_register_inbox_received(&messageReceived);
    const uint32_t inboxSize = 2048;
    const uint32_t outboxSize = 32;
    app_message_open(inboxSize, outboxSize);

    AppLaunchReason why = launch_reason();
    if (APP_LAUNCH_TIMELINE_ACTION == why) {
        uint32_t arg = launch_get_args();
        APP_LOG(APP_LOG_LEVEL_DEBUG, "launched from timeline pin %lu", arg);
    }
}

static void deinit() {
    window_destroy(theLoadScreen);
    window_destroy(theMainScreen);
    window_destroy(theErrorScreen);

#if PBL_API_EXISTS(app_glance_reload)
    app_glance_reload(refreshAppGlance, &theStudyQueue);
#endif
}

int main() {
    init();
    app_event_loop();
    deinit();
}

// -----------------------------------------------------------------------------
// Load Screen functions
// -----------------------------------------------------------------------------

static void drawLoadScreen(Layer* layer, GContext* ctx) {

    GRect bounds = layer_get_bounds(layer);
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    const char* text = theLoadMessage;
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
    GRect box = layer_get_bounds(layer);
    GTextOverflowMode overflow = GTextOverflowModeWordWrap;
    GTextAlignment alignment = GTextAlignmentCenter;

    GSize size = graphics_text_layout_get_content_size(
        text, font, box, overflow, alignment);
    box.origin.y = (box.size.h - size.h) / 2;

    graphics_draw_text(ctx, text, font, box, overflow, alignment, NULL);
}

static void loadLoadScreen(Window* window) {

    int index = rand() % ARRAY_LENGTH(kLoadMessages);
    theLoadMessage = kLoadMessages[index];

    Layer* layer = window_get_root_layer(window);
    layer_set_update_proc(layer, &drawLoadScreen);
}

static void unloadLoadScreen(Window* window) {
}

Window* createLoadScreen() {
    Window* window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = loadLoadScreen,
        .unload = unloadLoadScreen,
    });
    return window;
}

// -----------------------------------------------------------------------------
// Error Screen functions
// -----------------------------------------------------------------------------

static TextLayer* theErrorDisplay = NULL;

static void loadErrorScreen(Window* window) {
    Layer* windowLayer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(windowLayer);
    const GEdgeInsets insets = {
        .top = 10, .left = 10, .right = 10
    };

    theErrorDisplay = text_layer_create(grect_inset(bounds, insets));
    text_layer_set_text_alignment(theErrorDisplay, GTextAlignmentCenter);
    text_layer_set_overflow_mode(theErrorDisplay, GTextOverflowModeWordWrap);
    text_layer_set_font(theErrorDisplay, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_text_color(theErrorDisplay, GColorWhite);
    text_layer_set_background_color(theErrorDisplay, GColorClear);

    text_layer_set_text(theErrorDisplay,
        "Please provide your Public API Key in the settings.");

#if defined(PBL_ROUND)
    text_layer_enable_screen_text_flow_and_paging(theErrorDisplay, 3);
#endif

    layer_add_child(windowLayer, text_layer_get_layer(theErrorDisplay));
}

static void unloadErrorScreen(Window* window) {
    text_layer_destroy(theErrorDisplay);
    theErrorDisplay = NULL;
}

void setErrorCode(int32_t errorCode) {
    theErrorCode = errorCode;
    if (theErrorCode == 0) {
        if (theErrorScreen) {
            window_stack_remove(theErrorScreen, true);
        }
    } else {
        if (! theErrorScreen) {
            theErrorScreen = window_create();
            window_set_background_color(theErrorScreen, GColorFolly);
            window_set_window_handlers(theErrorScreen, (WindowHandlers) {
                .load = loadErrorScreen,
                .unload = unloadErrorScreen,
            });
        }
        window_stack_push(theErrorScreen, true);
    }
}

// -----------------------------------------------------------------------------
// Main Screen functions
// -----------------------------------------------------------------------------

static void drawText(GContext* ctx, int16_t x, int16_t y, int fontSize, const char* string, GTextAlignment alignment) {

    const char* fontKey;
         if (fontSize == 28) fontKey = FONT_KEY_GOTHIC_28;
    else if (fontSize == 24) fontKey = FONT_KEY_GOTHIC_24;
    else if (fontSize == 14) fontKey = FONT_KEY_GOTHIC_14;
    else return;

    GFont font = fonts_get_system_font(fontKey);
    GTextOverflowMode overflow = GTextOverflowModeWordWrap;
    GRect box;
    box.size.w = 144;
    box.size.h = fontSize;
    box.origin.y = y - fontSize;
    switch (alignment) {
        case GTextAlignmentLeft: box.origin.x = x; break;
        case GTextAlignmentCenter: box.origin.x = x - box.size.w / 2; break;
        case GTextAlignmentRight: box.origin.x = x - box.size.w; break;
    }
    graphics_draw_text(ctx, string, font, box, overflow, alignment, NULL);
}

static void drawMainScreen(Layer* layer, GContext* ctx) {

    DisplayData* display = &theDisplayData;

#if defined(PBL_ROUND)
int16_t availablesWidth = 32;
int16_t upcomingsWidth  = 8;
GTextAlignment upcomingHourAlignment = GTextAlignmentRight;
GTextAlignment upcomingDayAlignment = GTextAlignmentLeft;

int16_t         circlesBaseline = -45;
int16_t availableValuesBaseline = -35;
int16_t availableLabelsBaseline = -9;
int16_t nextReviewValueBaseline = 15;
int16_t nextReviewLabelBaseline = 30;
int16_t         dividerBaseline = 38;
int16_t  upcomingLabelsBaseline = 55;
int16_t  upcomingValuesBaseline = 75;

#else
int16_t availablesWidth = 34;
int16_t upcomingsWidth  = 36;
GTextAlignment upcomingHourAlignment = GTextAlignmentCenter;
GTextAlignment upcomingDayAlignment = GTextAlignmentCenter;

int16_t         circlesBaseline = -54;
int16_t availableValuesBaseline = -44;
int16_t availableLabelsBaseline = -18;
int16_t nextReviewValueBaseline = 11;
int16_t nextReviewLabelBaseline = 28;
int16_t         dividerBaseline = 38;
int16_t  upcomingValuesBaseline = 60;
int16_t  upcomingLabelsBaseline = 77;
#endif

    GRect bounds = layer_get_bounds(layer);
    int16_t centerCol           = bounds.size.w / 2;
    int16_t availableLessonsCol = centerCol - availablesWidth;
    int16_t availableReviewsCol = centerCol + availablesWidth;
    int16_t upcomingHourCol     = centerCol - upcomingsWidth;
    int16_t upcomingDayCol      = centerCol + upcomingsWidth;
    int16_t centerRow           = bounds.size.h / 2;
    int16_t dividerRow          = centerRow + dividerBaseline;
    int16_t circlesRow          = centerRow + circlesBaseline;
    int16_t availableValuesRow  = centerRow + availableValuesBaseline;
    int16_t availableLabelsRow  = centerRow + availableLabelsBaseline;
    int16_t nextReviewValueRow  = centerRow + nextReviewValueBaseline;
    int16_t nextReviewLabelRow  = centerRow + nextReviewLabelBaseline;
    int16_t upcomingValuesRow   = centerRow + upcomingValuesBaseline;
    int16_t upcomingLabelsRow   = centerRow + upcomingLabelsBaseline;


    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    int16_t radius = 23;
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
    graphics_fill_circle(ctx, GPoint(availableLessonsCol, circlesRow), radius);
    graphics_fill_circle(ctx, GPoint(availableReviewsCol, circlesRow), radius);

    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_draw_line(ctx, GPoint(0, dividerRow), GPoint(bounds.size.w, dividerRow));
    graphics_draw_line(ctx, GPoint(centerCol, dividerRow), GPoint(centerCol, bounds.size.h));

    graphics_context_set_text_color(ctx, GColorWhite);
    drawText(ctx, availableLessonsCol, availableValuesRow, 28, display->lessonsAvailable, GTextAlignmentCenter);
    drawText(ctx, availableReviewsCol, availableValuesRow, 28, display->reviewsAvailable, GTextAlignmentCenter);

    graphics_context_set_text_color(ctx, GColorBlack);
    drawText(ctx, availableLessonsCol, availableLabelsRow, 14, "Lessons", GTextAlignmentCenter);
    drawText(ctx, availableReviewsCol, availableLabelsRow, 14, "Reviews", GTextAlignmentCenter);
    drawText(ctx,           centerCol, nextReviewValueRow, 24, display->nextReview, GTextAlignmentCenter);
    drawText(ctx,           centerCol, nextReviewLabelRow, 14, "Next Review", GTextAlignmentCenter);
    drawText(ctx,     upcomingHourCol,  upcomingValuesRow, 24, display->reviewsAvailableNextHour, upcomingHourAlignment);
    drawText(ctx,      upcomingDayCol,  upcomingValuesRow, 24, display->reviewsAvailableNextDay, upcomingDayAlignment);
    drawText(ctx,     upcomingHourCol,  upcomingLabelsRow, 14, "Next Hour", upcomingHourAlignment);
    drawText(ctx,      upcomingDayCol,  upcomingLabelsRow, 14, "Next Day", upcomingDayAlignment);
}

static void loadMainScreen(Window* window) {
    Layer* layer = window_get_root_layer(window);
    layer_set_update_proc(layer, &drawMainScreen);
}

static void unloadMainScreen(Window* window) {
}

Window* createMainScreen() {
    Window* window = window_create();
    window_set_window_handlers(window, (WindowHandlers) {
        .load = loadMainScreen,
        .unload = unloadMainScreen,
    });
    return window;
}
