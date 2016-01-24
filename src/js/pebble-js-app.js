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
var options = {
        apikey: ''
    },
    userInfo,
    studyQueue,
    timelinePins = [];

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

function localDays(date) {
    var utcMinutes = date.getTime() / 1000 / 60,
        minutes = utcMinutes - date.getTimezoneOffset(),
        days = minutes / 60 / 24;
    return Math.floor(days);
}

function formatTimeSlot(timeSlot) {
    var date = new Date(timeSlot * 15 * 60 * 1000),
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
// ---------------------------------------------------------------------------
// Application Logic
// ---------------------------------------------------------------------------

Pebble.addEventListener('ready', function() {

    options = loadObject('options', options);
    userInfo = loadObject('user_information', userInfo);
    studyQueue = loadObject('study_queue', studyQueue);
    timelinePins = loadObject('timeline_pins', timelinePins);
    updateWaniKani();
});

function updateWaniKani() {

    if (options.apikey) {
        fetchStudyQueue();
    } else {
        Pebble.sendAppMessage({
            error: 1 /* ErrorNoUser */
        }, function (result) {
            console.log('appmsg - ack: txid ' + result.data.transactionId);
        }, function (result) {
            console.log('appmsg - nack: ' + JSON.stringify(result));
        });
    }
}

function fetchStudyQueue() {
    enqueJob(function () { wanikaniRequest('study-queue', receiveStudyQueue); });
    enqueJob(function () { wanikaniRequest('radicals', receiveTurtles); });
    enqueJob(function () { wanikaniRequest('kanji', receiveTurtles); });
    enqueJob(function () { wanikaniRequest('vocabulary', receiveTurtles); });
    enqueJob(function () {
        sendStudyQueue();
        pushReviewPins();
        saveObject('study_queue', studyQueue);
    });
    dequeNextJob();
}

function receiveStudyQueue(item, user_information, requested_information, error) {
    if (error) {
        console.log(JSON.stringify(error, null, 2));
        /* Abort further job queue processing and send an error report
           to the watch.  Report can included cached study queue data. */

    } else {
        userInfo = user_information;
        saveObject('user_information', userInfo);
        studyQueue = requested_information;
        dequeNextJob();
    }
}

function receiveTurtles(item, user_information, requested_information, error) {

    if (error) {
        console.log(JSON.stringify(error, null, 2));
        /* Abort further job queue processing and send an error report
           to the watch.  Report can included cached study queue data. */

    } else if (Array.isArray(requested_information)) {
        console.log('receiving ' + requested_information.length + ' ' + item);
        requested_information.forEach(function (item) {
            if (item.user_specific && item.user_specific.available_date) {
                var slotNumber = Math.floor(item.user_specific.available_date / (60*15));
                tallyTurtle(slotNumber);
            }
        });
        dequeNextJob();
    } else {
        console.log('expected array of ' + item);
    }
}

function tallyTurtle(slotNumber) {
    if (!studyQueue.hasOwnProperty('schedule')) {
        studyQueue.schedule = {};
    }
    if (studyQueue.schedule.hasOwnProperty(slotNumber)) {
        ++studyQueue.schedule[slotNumber];
    } else {
        studyQueue.schedule[slotNumber] = 1;
    }
}

/* Convert the schedule data into a byte array as follows:
 * Convert the slot number to an offset from the slot number of
 * the next_review_date and limit the schedule to 255 slots in the future
 * from then (about 2.6 days).  Cap the number of review items at 255.
 * For each slot, write two bytes to the array: slot offset and item count.
 * NOTE: A side effect of this function is that the time slots that are not
 * included in the message are also removed from the studyQueue.schedule.
 */
function sendStudyQueue() {
    'use strict';
    var nextReviewDate = new Date(studyQueue.next_review_date * 1000),
        nextReviewSlot = Math.floor(studyQueue.next_review_date / (60*15)),
        message = {
            username: userInfo.username,
            lessons_available: studyQueue.lessons_available,
            reviews_available: studyQueue.reviews_available,
            next_review_date: studyQueue.next_review_date,
            reviews_available_next_hour: studyQueue.reviews_available_next_hour,
            reviews_available_next_day: studyQueue.reviews_available_next_day,
            schedule: []
        };

    //console.log('next review ' + nextReviewDate.toDateString() + ' @ ' + nextReviewDate.toTimeString());
    Object.keys(studyQueue.schedule).forEach(function (timeSlot) {
        var itemCount = studyQueue.schedule[timeSlot];
        var slotBegin = (studyQueue.reviews_available) ? 1 : 0;
        var slotEnd = 256;
        var slotOffset = timeSlot - nextReviewSlot;
        if (slotOffset >= slotBegin && slotOffset < slotEnd) {
            message.schedule.push(slotOffset);
            message.schedule.push(Math.min(255, itemCount));
        }
    });

    console.log('appmsg - send: ' + JSON.stringify(message));
    Pebble.sendAppMessage(message, function (result) {
        console.log('appmsg - ack: txid ' + result.data.transactionId);
    }, function (result) {
        console.log('appmsg - nack: ' + JSON.stringify(result, null, 2));
    });
}

function pushReviewPins() {
    var nextReviewSlot = Math.floor(studyQueue.next_review_date / (15*60)),
        minReviewSlot = nextReviewSlot, // the earliest review found in the data
        maxReviewSlot = nextReviewSlot + 24 * 4, // after the last review we will push a pin for
        itemTotal = 0;
    Object.keys(studyQueue.schedule).forEach(function (timeSlot) {
        var itemCount = studyQueue.schedule[timeSlot],
            timeSlotDate = new Date(timeSlot * 15 * 60 * 1000),
            timeSlotStr = timeSlotDate.toLocaleString();

        itemTotal += itemCount;

        /* Keep track of the earliest review present in the schedule (which
           may be in the past). */
        if (timeSlot < minReviewSlot) {
            minReviewSlot = timeSlot;
        }

        /* Push a pin for reviews that are in the future.  We can tell
           that the next_review_date is in the future if there are zero
           reviews_available.  Limit pins to a 24 hour period starting
           from the next_review_date. */

        if (timeSlot == nextReviewSlot && !studyQueue.reviews_available) {
            pushReviewPin(timeSlot, itemCount, itemTotal);
        } else if (timeSlot > nextReviewSlot && timeSlot < maxReviewSlot) {
            pushReviewPin(timeSlot, itemCount, itemTotal);
        } else {
            /* Remove any reviews that we don't push a pin for.
               We do this to keep our localStorage object size under control. */
            delete studyQueue.schedule[timeSlot];
        }
    });

    removeOldPins(minReviewSlot);
    dequeNextJob();
}

function pushReviewPin(timeSlot, itemCount, itemTotal) {

    var now = new Date(),
        reviewDate = new Date(timeSlot * 15 * 60 * 1000),
        pinTime = reviewDate.toISOString(),
        subTitle = (itemCount == itemTotal) ?
            itemTotal + ' items.' :
            itemTotal + ' items (' + itemCount + ' new)';
        pin = {
            id: userInfo.username + '@' + timeSlot,
            time: pinTime,
            layout: {
                type: 'genericPin',
                title: 'WaniKani Review',
                subtitle: subTitle,
                tinyIcon: 'system://images/SCHEDULED_EVENT'
            },
            reminders: [{
                time: pinTime,
                layout: {
                    type: 'genericReminder',
                    tinyIcon: 'system://images/TIMELINE_CALENDAR',
                    title: itemTotal + ' reviews are available now.'
                }
            }],
            actions: [{
                title: 'Check',
                type: 'openWatchApp',
                launchCode: timeSlot
            }]
        };
    recordTimelinePin(timeSlot);
    insertUserPin(pin, function(responseText) {
        /* Probably want to actually check the response here... */

        dequeNextJob();
    });
}

function recordTimelinePin(timeSlot) {
    var found = timelinePins.indexOf(timeSlot);
    if (found < 0) {
        console.log('remember ' + formatTimeSlot(timeSlot));
        timelinePins.push(timeSlot);
    } else {
        console.log('affirm ' + formatTimeSlot(timeSlot));
    }
}

function removeOldPins(minTimeSlot) {
    var pinTimeSlot;
    var pins = timelinePins.slice();
    console.log('delete pins before ' + formatTimeSlot(minTimeSlot));
    pins.forEach(function (timeSlot) {
        var pin = { id: userInfo.username + '@' + timeSlot };
        if (timeSlot < minTimeSlot) {
            deleteUserPin(pin, function (response) {
                var found = timelinePins.indexOf(timeSlot);
                if (response === 'OK') {
                    console.log('forget ' + formatTimeSlot(timeSlot));
                    timelinePins.splice(found, 1);
                }
                dequeNextJob();
            });
        }
    });
    enqueJob(function () {
        console.log('save timeline pins');
        saveObject('timeline_pins', timelinePins);
    });
}

// ---------------------------------------------------------------------------
// App Configuration
// ---------------------------------------------------------------------------

Pebble.addEventListener('showConfiguration', function () {
    'use strict';
    console.log('show configuration');
    var watch = {platform: 'aplite'},
        jsonOptions = JSON.stringify(options),
        encodedOptions = encodeURIComponent(jsonOptions),
        url = 'http://files.mustacea.com/wanikani-tokidoki/dev/config.html',
        platform,
        nonce = '';

    //url = 'http://127.0.0.1:55683/config/index.html';

    if (Pebble.getActiveWatchInfo) {
        watch = Pebble.getActiveWatchInfo();
        console.log('active watch info: ' + JSON.stringify(watch, null, 2));
    }
    url += '?platform=' + watch.platform;
    url += '&nonce=' + Math.floor(new Date().getTime() / 1000);
    url += '#' + encodedOptions;
    console.log('open ' + url);
    Pebble.openURL(url);
});

Pebble.addEventListener("webviewclosed", function (e) {
    'use strict';
    console.log('Webview closed.');
    if (e.response && e.response.length) {
        options = JSON.parse(decodeURIComponent(e.response));
        console.log('save options: ' + JSON.stringify(options, null, 2));
        window.localStorage.setItem('options', JSON.stringify(options));
        updateWaniKani();
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
// Job Queue
// ---------------------------------------------------------------------------

var jobQueue = [];
var activeJob;

function enqueJob(job) {
    jobQueue.push(job);
}

function dequeNextJob() {
    if (jobQueue.length) {
        activeJob = jobQueue.shift();
        activeJob();
    } else {
        activeJob = null;
    }
}

// ---------------------------------------------------------------------------
// WaniKani API
// ---------------------------------------------------------------------------

function wanikaniRequest(item, handler) {
    var url = 'https://www.wanikani.com/api/user/' + options.apikey + '/' + item,
        xhr = new XMLHttpRequest();

    xhr.onload = function () {
        var response = JSON.parse(this.responseText),
            user_information,
            requested_information,
            error;
        if (response) {
            if (response.hasOwnProperty('user_information')) {
                user_information = response.user_information;
            }
            if (response.hasOwnProperty('requested_information')) {
                requested_information = response.requested_information;
                if (item === 'vocabulary' && requested_information.hasOwnProperty('general')) {
                    requested_information = requested_information.general;
                }
            }
            if (response.hasOwnProperty('error')) {
                error = response.error;
            }
        } else {
            error = {
                code: 'incomprehensible_response',
                message: 'Could not parse response as JSON'
            };
            console.log(this.responseText);
        }
        handler(item, user_information, requested_information, error);
    };
    xhr.open('GET', url);
    xhr.send();
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
function timelineRequest(pin, type, callback) {
  // User or shared?
  var url = API_URL_ROOT + 'v1/user/pins/' + pin.id;

  // Create XHR
  var xhr = new XMLHttpRequest();
  xhr.onload = function () {
    console.log('timeline - response received: ' + this.responseText);
    callback(this.responseText);
  };
  xhr.onerror = function () {
      console.log('timeline - error: ' + this.statusText);
      callback(null);
  };
  xhr.open(type, url);

  // Get token
  Pebble.getTimelineToken(function (token) {
        // Add headers
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-User-Token', '' + token);

        // Send
        xhr.send(JSON.stringify(pin));
        console.log('timeline - request sent: ' + type + ' ' + JSON.stringify(pin));
    }, function (error) {
       console.log('timeline - error getting timeline token: ' + error);
    });
}

/**
 * Insert a pin into the timeline for this user.
 * @param pin The JSON pin to insert.
 * @param callback The callback to receive the responseText after the request has completed.
 */
function insertUserPin(pin, callback) {
    enqueJob(function () { timelineRequest(pin, 'PUT', callback); });
}

/**
 * Delete a pin from the timeline for this user.
 * @param pin The JSON pin to delete.
 * @param callback The callback to receive the responseText after the request has completed.
 */
function deleteUserPin(pin, callback) {
    enqueJob(function () { timelineRequest(pin, 'DELETE', callback); });
}

/***************************** end timeline lib *******************************/
