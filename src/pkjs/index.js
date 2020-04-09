'use strict';
/*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
/*global Pebble */

var userName,
    wanikaniSummary,
    timelinePins = [];

var Clay = require('pebble-clay');
var clayConfig = require('./config.js');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });
var messageKeys = require('message_keys');
var _ = require('underscore');

var Jobber = require('./jobber.js');
var jobber = new Jobber();

var WaniKani = require('./wanikani.js');
var AppReadyService = require('./pebble-app-ready-service.js');

/* Polyfill */
if (!String.prototype.startsWith) {
    Object.defineProperty(String.prototype, 'startsWith', {
        value: function(search, rawPos) {
            var pos = rawPos > 0 ? rawPos|0 : 0;
            return this.substring(pos, pos + search.length) === search;
        }
    });
}

// ---------------------------------------------------------------------------
// Application Logic
// ---------------------------------------------------------------------------

AppReadyService.ready(function () {
    console.log('Ready.');
    timelinePins = loadObject('timeline_pins', timelinePins);
    console.log('Loaded timelinePins ' + JSON.stringify(timelinePins, null, 2));
});

Pebble.addEventListener('appmessage', function (event) {

    if (event.payload.REFRESH) {
        console.log('Watch has requested study schedule update.');

        var settings = JSON.parse(localStorage.getItem('clay-settings')) || {};

        if (_.has(settings, 'API_TOKEN')) {
            var wanikani = new WaniKani(settings['API_TOKEN']);
            fetchStudyQueue(wanikani);
        } else {
            var message = {
                'CONFIGURE': 'Please provide your Personal Access Token in settings.'
            };
            Pebble.sendAppMessage(message, function () {
                console.log('Prompted for WaniKani API Token.');
            }, function (data, error) {
                console.error(error);
                console.error('Could not send API Token request.');
            });
        }
    }

});

function enqueProgressReport(type, text) {
    var message = {};
    message[type] = text;
    jobber.enqueMessage(message, 'Report ' + type + ': ' + text);
}

function fetchStudyQueue(wanikani) {

    var onWaniKaniError = function(error) {
        jobber.cancelAllJobs();
        terminateWithError(error.message);
    }

    enqueProgressReport('PROGRESS', 'Consulting the Crabigator');
    jobber.enqueJob(function (_next, _abort) { wanikani.request('user', receiveUser, onWaniKaniError); });

    enqueProgressReport('PROGRESS', 'Receiving the Summary');
    jobber.enqueJob(function (_next, _abort) { wanikani.request('summary', receiveSummary, onWaniKaniError); });

    var timelineToken;
    if (Pebble.getActiveWatchInfo().model.startsWith('qemu')) {
        jobber.enqueJob(function(next, _abort) {
            console.warn('Emulator cannot access timeline token.');
            next();
        });
    } else {
        enqueProgressReport('PROGRESS', 'Altering the Timeline');
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
    }

    enqueProgressReport('PROGRESS', 'Pushing the Pins');
    jobber.enqueJob(function (next, _abort) {
        /* This job just enqueues more jobs, but it needs the above jobs to
           complete before it has the data to work from. */        
        pushReviewPins(timelineToken); /* enqueues several jobs */
        sendStudySummary(); /* enqueues one job */
        next();
    });

    jobber.start();
}

function receiveUser(user) {
    userName = user.username;
    jobber.dequeNextJob();
}

function receiveSummary(summary) {

    var msecPerHour = 1000 * 60 * 60;
    var reviews = _.map(summary.reviews, function (entry) { return {
        epochHour: Math.floor(new Date(entry.available_at).valueOf() / msecPerHour),
        subjectCount: entry.subject_ids.length
    }});
    reviews = _.filter(reviews, function (entry) {
        return entry.subjectCount > 0;
    });
    reviews[0].subjectTotal = reviews[0].subjectCount;
    for (var k = 1; k < reviews.length; ++k) {
        reviews[k].subjectTotal = reviews[k - 1].subjectTotal + reviews[k].subjectCount;
    }

    wanikaniSummary = {
        lessons: summary.lessons[0].subject_ids.length,
        reviews: reviews
    };
    console.log(JSON.stringify(wanikaniSummary, null, 2));

    jobber.dequeNextJob();
}

function sendStudySummary() {
    'use strict';
    var schedule = [],
        baseEpochHour = wanikaniSummary.reviews[0].epochHour,
        message = {
            'SUCCESS': true,
            'EPOCH_HOUR': baseEpochHour,
            'LESSON_COUNT': wanikaniSummary.lessons,
            'REVIEW_COUNT': wanikaniSummary.reviews[0].subjectCount,
            'REVIEW_FORECAST': schedule
        };
    _.each(wanikaniSummary.reviews.slice(1), function (entry) {
        if (entry.subjectCount) {
            schedule.push(entry.epochHour - baseEpochHour);
            schedule.push(Math.min(255, entry.subjectCount));
        }
    });
    jobber.enqueMessage(message, 'send: ' + JSON.stringify(message, null, 2));
}

/* This function enqueues a number of jobs.
 */
function pushReviewPins(timelineToken) {

    /* Enque a pin job for each current schedule entry. */
    _.each(wanikaniSummary.reviews, function (entry) {

        var isoTime = new Date(entry.epochHour * 60 * 60 * 1000).toISOString(),
            subTitle = (entry.subjectCount == entry.subjectTotal) ?
                entry.subjectTotal + ' items.' :
                entry.subjectTotal + ' items (' + entry.subjectCount + ' new)',
        pin = {
            id: userName + '@' + entry.epochHour,
            time: isoTime,
            layout: {
                type: 'genericPin',
                title: 'WaniKani Review',
                subtitle: subTitle,
                tinyIcon: 'system://images/SCHEDULED_EVENT'
            },
            actions: [{
                title: 'Check',
                type: 'openWatchApp',
                launchCode: entry.epochHour
            }]
        };
        if (entry.subjectCount != entry.subjectTotal) {
            pin.reminders = [{
                time: isoTime,
                layout: {
                    type: 'genericReminder',
                    tinyIcon: 'system://images/TIMELINE_CALENDAR',
                    title: entry.subjectTotal + ' reviews are available now.'
                }
            }];
        }

        //console.log(JSON.stringify(pin, null, 2));

        /* NOTE(jr) I do not understand why this extra function closure is
           necessary here to capture each distinct pin.  The pin variable is
           already function scoped within the forEach iteration function and
           I don't see how all the jobs can end up referencing the single,
           "last" pin created. */
        if (timelineToken) {
            (function (pin) {
                jobber.enqueJob(function (next, abort) {
                    //console.log('Push pin ' + entry.epochHour + ' @' + formatTimeSlot(entry.epochHour));
                    timelineRequest(timelineToken, pin, 'PUT', function () {
                        rememberTimelinePin(entry);
                        next();
                    }, abort);
                });
            })(pin);
        }
    });

    /* Queue a pin deletion job for any outdated pins we know about. */
    var baseEpochHour = wanikaniSummary.reviews[0].epochHour;
    _.each(timelinePins.slice(), function (epochHour) {
        if (epochHour > (baseEpochHour + 36)) {
            var found = timelinePins.indexOf(epochHour);
            console.log('obliviate ' + epochHour);
            timelinePins.splice(found, 1);            
        }
    });
    _.each(timelinePins.slice(), function (epochHour) {
        var pin = { id: userName + '@' + epochHour };
        if (epochHour < baseEpochHour) {
            /* See above for notes on this seemingly extraneous closure. */
            if (timelineToken) {
                (function (pin) {
                    jobber.enqueJob(function (next, abort) {
                        //console.log('Delete pin ' + epochHour + ' @' + formatTimeSlot(epochHour));
                        timelineRequest(timelineToken, pin, 'DELETE', function () {
                            forgetTimelinePin(epochHour);
                            next();
                        }, abort);
                    });
                })(pin);
            }
        }
    });

    /* Queue a job to save the timeline pin records after the above cleanup
     * jobs have completed. */
    jobber.enqueJob(function (next, _abort) {
        console.log('Save timeline pins.');
        saveObject('timeline_pins', timelinePins);
        next();
    });
}

function rememberTimelinePin(entry) {
    var found = timelinePins.indexOf(entry.epochHour),
        what = '+' + entry.subjectCount + '=' + entry.subjectTotal + ' @' + formatTimeSlot(entry.epochHour);
    if (found < 0) {
        console.log('Remember ' + what);
        timelinePins.push(entry.epochHour);
    } else {
        console.log('Affirm ' + what);
    }
}

function forgetTimelinePin(epochHour) {
    var found = timelinePins.indexOf(epochHour);
    console.log('Forget ' + formatTimeSlot(epochHour));
    timelinePins.splice(found, 1);
}

function formatTimeSlot(epochHour) {
    var date = new Date(epochHour * 60 * 60 * 1000),
        slotDay = localDays(date),
        today = localDays(new Date()),
        days = slotDay - today,
        hour = (date.getHours() < 10 ? '0' : '') + date.getHours(),
        minute = (date.getMinutes() < 10 ? '0' : '') + date.getMinutes(),
        day = '';

    if (days < -1) {
        day = ' (' + -days + ' days ago)';
    } else if (days == -1) {
        day = ' (yesterday)';
    } else if (days == 1) {
        day = ' (tomorrow)';
    } else if (days > 1) {
        day = ' (' + days + ' days from now)';
    }

    return hour + ':' + minute + day;
}

function localDays(date) {
    var utcMinutes = date.getTime() / 1000 / 60,
        minutes = utcMinutes - date.getTimezoneOffset(),
        days = minutes / 60 / 24;
    return Math.floor(days);
}

function terminateWithError(errorText) {
    var message = {};
    message[messageKeys.ERROR] = errorText.substring(0, 128);
    Pebble.sendAppMessage(message, function (_data) {
        console.error('Reported error to watch: ' + errorText);
    }, function (_data, _error) {
        console.error('Could not even send an error message to the watch! ' + errorText);
    });
}

// ---------------------------------------------------------------------------
// App Configuration
// ---------------------------------------------------------------------------

Pebble.addEventListener('showConfiguration', function () {
    'use strict';
    console.log('Show configuration.');

    enqueProgressReport('CONFIGURE', 'Configuring.');
    jobber.start();

    /* Request the config URL from Clay.  Clay will load current settings
       from localStorage and use them to generate the config page, but they
       are not cached within Clay for access by clients (us). */
    var configURL = clay.generateUrl();

    /* Show the config page. */
    Pebble.openURL(configURL);
});

Pebble.addEventListener('webviewclosed', function (event) {
    'use strict';
    if (event.response && event.response.length) {
        console.log('Receive configuration.');

        var settings = clay.getSettings(event.response),
            token = settings[messageKeys.API_TOKEN];

        if (token) {
            var wanikani = new WaniKani(token);
            fetchStudyQueue(wanikani);
        }
    } else {
        console.log('Configuration canceled.');
        enqueProgressReport('CONFIGURE', 0);
        jobber.start();
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
var API_URL_ROOT = 'https://timeline-api.rebble.io/';

/**
 * Send a request to the Pebble public web timeline API.
 * @param pin The JSON pin to insert. Must contain 'id' field.
 * @param type The type of request, either PUT or DELETE.
 * @param callback The callback to receive the responseText after the request has completed.
 */
function timelineRequest(timelineToken, pin, type, next, abort) {
    var url = API_URL_ROOT + 'v1/user/pins/' + pin.id;

    // Create XHR
    var xhr = new XMLHttpRequest();
    xhr.onload = function () {
        if (this.status === 200) {
            //console.log(this.responseText);
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
    //console.log('Timeline ' + type + ': ' + JSON.stringify(pin, null, 2));
    xhr.send(JSON.stringify(pin));
}

/***************************** end timeline lib *******************************/
