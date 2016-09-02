/*jslint
    eqeq: true,
    vars: true,
    bitwise: true
*/
/*global
    Pebble: false,
    window: false,
    console: false,
    XMLHttpRequest: false
*/

/* Initialize default options. */
var userInfo,
    studyQueue,
    timelinePins = [];

var Clay = require('pebble-clay');
var clayConfig = require('./config.js');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });
var messageKeys = require('message_keys');
var _ = require('underscore');

var Jobber = require('./jobber.js');
var jobber = new Jobber();

var WaniKani = require('./wanikani.js');

// ---------------------------------------------------------------------------
// Application Logic
// ---------------------------------------------------------------------------

Pebble.addEventListener('ready', function () {

    userInfo = loadObject('user_information', userInfo);
    timelinePins = loadObject('timeline_pins', timelinePins);

    if (userInfo && userInfo.hasOwnProperty('apikey')) {
        var wanikani = new WaniKani(userInfo.apikey);
        fetchStudyQueue(wanikani);
    } else {
        var message = {
            PUBLIC_API_KEY: 1
        };
        Pebble.sendAppMessage(message, function (data) {
            console.log('Requested WaniKani Public API Key. (' + data.transactionId + ')');
        }, function (data, error) {
            console.error(error);
            console.error('Could not send Public API Key request.');
        });
    }
});

function reportProgress(type, text) {
    var message = {};
    message[type] = text;
    jobber.enqueMessage(message, 'Report progress: ' + text);
}

function fetchStudyQueue(wanikani) {

    reportProgress('PROGRESS', 'Study Queue');
    jobber.enqueJob(function (next, abort) { wanikani.request('study-queue', receiveStudyQueue); });

    reportProgress('PROGRESS', 'Radicals');
    jobber.enqueJob(function (next, abort) { wanikani.request('radicals', receiveTurtles); });

    reportProgress('PROGRESS', 'Kanji');
    jobber.enqueJob(function (next, abort) { wanikani.request('kanji', receiveTurtles); });

    reportProgress('PROGRESS', 'Vocabulary');
    jobber.enqueJob(function (next, abort) { wanikani.request('vocabulary', receiveTurtles); });

    reportProgress('PROGRESS', 'Timeline');

    var timelineToken;
    jobber.enqueJob(function (next, abort) {
        Pebble.getTimelineToken(function (token) {
            console.log('Aquired timeline token: ' + token);
            timelineToken = token;
            next();
        }, function (error) {
            abort();
            console.error(error);
            terminateWithError('Could not access timeline token.');
        });
    });

    jobber.enqueJob(function (next, abort) {
        /* All of these functions can prepare their jobs once the above jobs
           have completed. */
        finalizeSchedule();

        reportProgress('PROGRESS', 'Glance');
        updateAppGlance(); /* enqueues a job */

        reportProgress('PROGRESS', 'Pins');
        pushReviewPins(timelineToken); /* enqueues several jobs */

        var message = {
            SUCCESS: 'Review schedule has been updated!  Results should appear on the Timeline within 15 minutes.'
        };
        jobber.enqueMessage(message, 'Reporting success to the watch.');

        next();
    });
    jobber.dequeNextJob();
}

function receiveStudyQueue(item, user_information, requested_information, error) {
    if (error) {
        jobber.cancelAllJobs();
        terminateWithError(error.message);

    } else {
        userInfo = user_information;
        saveObject('user_information', userInfo);
        studyQueue = requested_information;
        jobber.dequeNextJob();
    }
}

/*
 * We do not record any burned items because they cannot actually be in the
 * review schedule.
 * We are careful not to record any review items that are already accounted
 * for in the reviews_available.  This means that if there are currently reviews
 * then all available items up to and including the next_review_date are ignored.
 * If there are no reviews available, then no un-burned items will be available
 * before next_review_date and we can tally all un-burned items.
 */
function receiveTurtles(item, user_information, requested_information, error) {

    if (error) {
        jobber.cancelAllJobs();
        terminateWithError(error.message);

    } else if (Array.isArray(requested_information)) {
        console.log('receiving ' + requested_information.length + ' ' + item);
        var nextReviewSlot = Math.floor(studyQueue.next_review_date / (15*60));
        _.each(requested_information, function (item) {
            if (item.user_specific && item.user_specific.available_date && !item.user_specific.burned) {
                var timeSlot = Math.floor(item.user_specific.available_date / (60*15));
                if (timeSlot > nextReviewSlot || studyQueue.reviews_available === 0) {
                    tallyTurtle(timeSlot);
                }
            }
        });
        jobber.dequeNextJob();

    } else {
        jobber.cancelAllJobs();
        terminateWithError('Sorry, I am confused by the WaniKani ' + item + '.');
    }
}

function tallyTurtle(timeSlot) {
    if (!studyQueue.hasOwnProperty('schedule')) {
        studyQueue.schedule = {};
    }
    if (studyQueue.schedule.hasOwnProperty(timeSlot)) {
        ++studyQueue.schedule[timeSlot];
    } else {
        studyQueue.schedule[timeSlot] = 1;
    }
}

/**
 * Convert the study schedule from a map of timeSlot->itemCount to an
 * array of {timeSlot,itemCount}.
 */
function finalizeSchedule() {

    /* First convert to array of objects. */
    var schedule = _.map(studyQueue.schedule, function (itemCount, timeSlot) {
        return {
            timeSlot: parseInt(timeSlot, 10),
            newItems: itemCount
        };
    });

    /* Synthesize an entry for the currently available reviews,
     * which may be zero.
     */
    schedule.push({
        timeSlot: Math.floor(Date.now() / (15*60*1000)),
        newItems: studyQueue.reviews_available,
        totalItems: studyQueue.reviews_available
    });

    /* Sort schedule by timeSlot. */
    schedule = _.sortBy(schedule, 'timeSlot');

    /* Compute duration and expiration (in slot units).
     * The last entry will not have these fields set.
     * Interpret this as infinite duration.
     */
    for (var k = 1; k < schedule.length; ++k) {
        schedule[k-1].duration = schedule[k].timeSlot - schedule[k-1].timeSlot;
        schedule[k-1].expiration = schedule[k].timeSlot;
        schedule[k].totalItems = schedule[k-1].totalItems + schedule[k].newItems;
    }

    /* Limit the schedule to two days. */
    var limit = Math.floor(studyQueue.next_review_date / (15*60)) + (2*24*4);
    schedule = _.filter(schedule, function (entry) {
        return entry.timeSlot < limit;
    });

    studyQueue.schedule = schedule;
}

/* This function enqueues a number of jobs.
 */
function pushReviewPins(timelineToken) {

    /* Enque a pin job for each current schedule entry. */
    studyQueue.schedule.forEach(function (entry) {

        var timeSlotDate = new Date(entry.timeSlot * 15 * 60 * 1000),
            timeSlotISO = timeSlotDate.toISOString(),
            subTitle = (entry.newItems == entry.totalItems) ?
                entry.totalItems + ' items.' :
                entry.totalItems + ' items (' + entry.newItems + ' new)';
            pin = {
                id: userInfo.username + '@' + entry.timeSlot,
                time: timeSlotISO,
                duration: entry.duration * 15,
                layout: {
                    type: 'genericPin',
                    title: 'WaniKani Review',
                    subtitle: subTitle,
                    tinyIcon: 'system://images/SCHEDULED_EVENT'
                },
                reminders: [{
                    time: timeSlotISO,
                    layout: {
                        type: 'genericReminder',
                        tinyIcon: 'system://images/TIMELINE_CALENDAR',
                        title: entry.totalItems + ' reviews are available now.'
                    }
                }],
                actions: [{
                    title: 'Check',
                    type: 'openWatchApp',
                    launchCode: entry.timeSlot
                }]
            };

        rememberTimelinePin(entry);

        /* NOTE(jr) I do not understand why this extra function closure is
           necessary here to capture each distinct pin.  The pin variable is
           already function scoped within the forEach iteration function and
           I don't see how all the jobs can end up referencing the single,
           "last" pin created. */
        (function (pin) {
            jobber.enqueJob(function (next, abort) {
                timelineRequest(timelineToken, pin, 'PUT', next, abort);
            });
        })(pin);

    });

    /* Queue a pin deletion job for any outdated pins we know about. */
    var nowTimeSlot = Math.floor(Date.now() / (15*60*1000));
    console.log('delete pins before ' + formatTimeSlot(nowTimeSlot));
    var pinTimeSlot;
    _.each(timelinePins.slice(), function (timeSlot) {
        var pin = { id: userInfo.username + '@' + timeSlot };
        if (timeSlot < nowTimeSlot) {
            /* See above for notes on this seemingly extraneous closure. */
            (function (pin) {
                jobber.enqueJob(function (next, abort) {
                    timelineRequest(timelineToken, pin, 'DELETE', function () {
                        forgetTimelinePin(timeSlot);
                        next();
                    }, abort);
                });
            })(pin);
        }
    });

    /* Queue a job to save the timeline pin records after the above cleanup
     * jobs have completed. */
    jobber.enqueJob(function (next, abort) {
        console.log('Save timeline pins.');
        saveObject('timeline_pins', timelinePins);
        next();
    });
}

function rememberTimelinePin(entry) {
    var found = timelinePins.indexOf(entry.timeSlot),
        what = '+' + entry.newItems + '=' + entry.totalItems + ' @';
    if (found < 0) {
        console.log('remember ' + what + formatTimeSlot(entry.timeSlot, entry.duration));
        timelinePins.push(entry.timeSlot);
    } else {
        console.log('affirm ' + what + formatTimeSlot(entry.timeSlot, entry.duration));
    }
}

function forgetTimelinePin(timeSlot) {
    var found = timelinePins.indexOf(timeSlot);
    console.log('forget ' + formatTimeSlot(timeSlot));
    timelinePins.splice(found, 1);
}

function formatTimeSlot(timeSlot, duration) {
    var date = new Date(timeSlot * 15 * 60 * 1000),
        slotDay = localDays(date),
        today = localDays(new Date()),
        days = slotDay - today,
        hour = (date.getHours() < 10 ? '0' : '') + date.getHours(),
        minute = (date.getMinutes() < 10 ? '0' : '') + date.getMinutes(),
        day = '',
        durationString = '';

    if (duration) {
        var durationMinutes = duration * 15,
            durationHours = Math.floor(durationMinutes / 60),
            durationDays = Math.floor(durationHours / 24);
        durationHours = durationHours % 24;
        durationMinutes = durationMinutes % 60;
        durationString = ' + ';
        if (durationDays > 1) {
            durationString = durationString + durationDays + ' days ';
        } else if (durationDays > 0) {
            durationString = durationString + durationDays + ' day ';
        }
        if (durationHours > 0) {
            durationString = durationString + durationHours;
        }
        if (durationMinutes > 9) {
            durationString = durationString + ':' + durationMinutes;
        } else {
            durationString = durationString + ':0' + durationMinutes;
        }
    }

    if (days < -1) {
        day = ' (' + -days + ' days ago)';
    } else if (days == -1) {
        day = ' (yesterday)';
    } else if (days == 1) {
        day = ' (tomorrow)';
    } else if (days > 1) {
        day = ' (' + days + ' days from now)';
    }

    return hour + ':' + minute + day + durationString;
}

function localDays(date) {
    var utcMinutes = date.getTime() / 1000 / 60,
        minutes = utcMinutes - date.getTimezoneOffset(),
        days = minutes / 60 / 24;
    return Math.floor(days);
}

/* Enques one job. */
function updateAppGlance() {

    var slices = _.map(studyQueue.schedule, function (entry) {
        var slice = {
                layout: {
                    icon: 'app://images/ICON',
                    subtitleTemplateString: entry.totalItems + ' reviews, ' + studyQueue.lessons_available + ' lessons available.'
                }
            };
        if (entry.expiration) {
            slice.expirationTime = new Date(entry.expiration * (1000*60*15)).toISOString();
        }
        return slice;
    });

    jobber.enqueJob(function (next, abort) {
        //console.log('AppGlance slices: ' + JSON.stringify(slices, null, 2));
        Pebble.appGlanceReload(slices, function () {
            console.log('AppGlance: Reloaded ' + slices.length);
            next();
        }, function () {
            abort();
            terminateWithError('Failed to reload AppGlance.');
        });
    });

}

function terminateWithError(errorText) {
    var message = {};
    message[messageKeys.ERROR] = errorText.substring(0, 128);
    Pebble.sendAppMessage(message, function (data) {
        console.error('Reported error to watch: ' + errorText);
    }, function (data, error) {
        console.error('Could not even send an error message to the watch! ' + errorText);
    });
}

// ---------------------------------------------------------------------------
// App Configuration
// ---------------------------------------------------------------------------

Pebble.addEventListener('showConfiguration', function () {
    'use strict';
    console.log('Show configuration.');

    /* Request the config URL from Clay.  Clay will load current settings
       from localStorage and use them to generate the config page, but they
       are not cached within Clay for access by clients (us). */
    var configURL = clay.generateUrl();

    /* Show the config page. */
    Pebble.openURL(configURL);
});

Pebble.addEventListener('webviewclosed', function (e) {
    'use strict';
    if (e.response && e.response.length) {
        console.log('Receive configuration.');

        var settings, apikey;

        /* Request decoded settings from Clay.  As a side-effect,
           Clay will save the settings to local storage. */
        settings = clay.getSettings(e.response);

        /* If there were any settings that the C code was interested in,
           this would be the place to extract them, convert them, and
           send them. */

        apikey = settings[messageKeys.PUBLIC_API_KEY];
        if (apikey) {
            var wanikani = new WaniKani(apikey);
            fetchStudyQueue(wanikani);
        }
    } else {
        console.log('Configuration canceled.');
    }
});

// ---------------------------------------------------------------------------
// Local Storage
// ---------------------------------------------------------------------------

function saveObject(name, value) {
    window.localStorage.setItem(name, JSON.stringify(value));
}

function loadObject(name, defaultValue) {
    var encodedValue = window.localStorage.getItem(name),
        value;
    if (encodedValue) {
        try {
            value = JSON.parse(encodedValue);
            //console.log(name + ': ' + JSON.stringify(value, null, 2));
        } catch (ex) {
            console.log('clear corrupted ' + name + ': ' + encodedValue);
            window.localStorage.removeItem(name);
            value = defaultValue;
        }
    } else {
        value = defaultValue;
    }
    return value;
}

// ---------------------------------------------------------------------------
// Timeline API
// ---------------------------------------------------------------------------

// The timeline public URL root
var API_URL_ROOT = 'https://timeline-api.getpebble.com/';

/**
 * Send a request to the Pebble public web timeline API.
 * @param pin The JSON pin to insert. Must contain 'id' field.
 * @param type The type of request, either PUT or DELETE.
 * @param callback The callback to receive the responseText after the request has completed.
 */
function timelineRequest(timelineToken, pin, type, next, abort) {
    // User or shared?
    var url = API_URL_ROOT + 'v1/user/pins/' + pin.id;

    // Create XHR
    var xhr = new XMLHttpRequest();
    xhr.onload = function () {
        if (this.status === 200) {
            next();
        } else {
            abort();
            console.error(this.responseText);
            terminateWithError('Failed to ' + type + ' timeline pin.');
        }
    };
    xhr.onerror = function () {
        abort();
        console.error(this.responseText);
        terminateWithError('Failed to ' + type + ' timeline pin.');
    };
    xhr.open(type, url);

    // Add headers
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-User-Token', timelineToken);

    // Send
    xhr.send(JSON.stringify(pin));
    // console.log('Timeline ' + type + ': ' + JSON.stringify(pin, null, 2));
}

/***************************** end timeline lib *******************************/
