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
    studyQueue;

function saveOptions() {
    window.localStorage.setItem('options', JSON.stringify(options));
}

function loadOptions() {
    var storedOptions = window.localStorage.getItem('options');
    if (storedOptions) {
        try {
            options = JSON.parse(storedOptions);
            console.log('loaded options: ' + JSON.stringify(options, null, 2));
        } catch (ex) {
            console.log('clear corrupt options');
            window.localStorage.clear();
        }
    }
}

function saveUserInfo() {
    window.localStorage.setItem('user_information', JSON.stringify(userInfo));
}

function loadUserInfo() {
    var encodedUserInfo = window.localStorage.getItem('user_information');
    if (encodedUserInfo) {
        try {
            userInfo = JSON.parse(encodedUserInfo);
            // console.log('loaded user info: ' + JSON.stringify(userInfo, null, 2));
        } catch (ex) {
            console.log('clear corrupt user info');
            window.localStorage.clear();
        }
    }

}

function saveStudyQueue() {
    //console.log('save study queue: ' + JSON.stringify(studyQueue, null, 2));
    window.localStorage.setItem('study_queue', JSON.stringify(studyQueue));
}

function loadStudyQueue() {
    var encodedStudyQueue = window.localStorage.getItem('study_queue');
    if (encodedStudyQueue) {
        try {
            studyQueue = JSON.parse(encodedStudyQueue);
            //console.log('loaded study queue: ' + JSON.stringify(studyQueue, null, 2));
        } catch (ex) {
            console.log('clear corrupt study queue: \n' + encodedStudyQueue);
            window.localStorage.clear();
        }
    }
}

/* Convert the schedule data into a byte array as follows:
 * Convert the slot number to an offset from the slot number of
 * the next_review_date and limit the schedule to 255 slots in the future
 * from then (about 2.6 days).  Cap the number of review items at 255.
 * For each slot, write two bytes to the array: slot offset and item count.
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
        maxReviewSlot = nextReviewSlot + 24 * 4,
        itemTotal = 0;
    //console.log('next review slot: ' + nextReviewSlot);
    //console.log('max review slot: ' + maxReviewSlot);
    //console.log(studyQueue.reviews_available + ' reviews available');
    Object.keys(studyQueue.schedule).forEach(function (timeSlot) {
        var itemCount = studyQueue.schedule[timeSlot],
            timeSlotDate = new Date(timeSlot * 15 * 60 * 1000),
            timeSlotStr = timeSlotDate.toLocaleString();

        itemTotal += itemCount;

        //console.log('review ' + timeSlot + ' ' + timeSlotStr + ' +' + itemCount + ' =' + itemTotal);

        /* Push a pin for reviews that are in the future.  We can tell
           that the next_review_date is in the future if there are zero
           reviews_available.  Limit pins to a 24 hour period starting
           from the next_review_date. */

        if (timeSlot == nextReviewSlot && !studyQueue.reviews_available) {
            pushReviewPin(timeSlot, itemCount, itemTotal);
        } else if (timeSlot > nextReviewSlot && timeSlot < maxReviewSlot) {
            pushReviewPin(timeSlot, itemCount, itemTotal);
        }
    });
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
    insertUserPin(pin, function(responseText) {
        // nothing to do here...
    });
}

function incrementSlot(slotNumber) {
    if (!studyQueue.hasOwnProperty('schedule')) {
        studyQueue.schedule = {};
    }
    if (studyQueue.schedule.hasOwnProperty(slotNumber)) {
        ++studyQueue.schedule[slotNumber];
    } else {
        studyQueue.schedule[slotNumber] = 1;
    }
}

function fetchItems(itemType, then) {
    console.log('fetch ' + itemType);
    wanikaniRequest(itemType, function(user_information, requested_information, error) {
        if (error) {
            console.log(JSON.stringify(error, null, 2));
        } else if (Array.isArray(requested_information)) {
            //console.log('received ' + requested_information.length + ' ' + itemType );
            requested_information.forEach(function (item) {
                if (item.user_specific && item.user_specific.available_date) {
                    var slotNumber = Math.floor(item.user_specific.available_date / (60*15));
                    incrementSlot(slotNumber);
                }
            });
            then();
        } else {
            console.log('expected array of ' + itemType);
        }
    });
}

function fetchStudyQueue() {
    wanikaniRequest('study-queue', function(user_information, requested_information, error) {
        if (error) {
            console.log(JSON.stringify(error, null, 2));
        } else {
            userInfo = user_information;
            saveUserInfo();
            studyQueue = requested_information;
            fetchItems('radicals', function () {
                fetchItems('kanji', function () {
                    fetchItems('vocabulary', function () {
                        saveStudyQueue();
                        sendStudyQueue();
                        pushReviewPins();
                    });
                });
            });
        }
    });
}

function fetchAllTheThings() {
    if (options.apikey) {
        loadStudyQueue();
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

Pebble.addEventListener('ready', function() {
    loadOptions();
    loadUserInfo();
    fetchAllTheThings();
});

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
        fetchAllTheThings();
    }
});

/******************************* wanikani lib *********************************/

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
        handler(user_information, requested_information, error);
    };
    xhr.open('GET', url);
    xhr.send();
}

/******************************* timeline lib *********************************/

// The timeline public URL root
var API_URL_ROOT = 'https://timeline-api.getpebble.com/';
var timelineJobQueue = [];
var timelineActiveJob;

function timelineEnqueRequest(pin, type, callback) {
    timelineJobQueue.push({
        pin: pin,
        type: type,
        callback: callback
    });
    if (! timelineActiveJob) {
        timelineDequeRequest();
    }
}

function timelineDequeRequest() {
    timelineActiveJob = timelineJobQueue.shift();
    timelineRequest(timelineActiveJob.pin, timelineActiveJob.type, function (responseText) {
        var job = timelineActiveJob;
        timelineActiveJob = null;
        if (timelineJobQueue.length) {
            timelineDequeRequest();
        } else {
            job.callback(responseText);
        }
    });
}

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
  xhr.open(type, url);

  // Get token
  Pebble.getTimelineToken(function (token) {
        // Add headers
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-User-Token', '' + token);

        // Send
        xhr.send(JSON.stringify(pin));
        console.log('timeline - request sent: ' + JSON.stringify(pin));
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
    timelineEnqueRequest(pin, 'PUT', callback);
}

/**
 * Delete a pin from the timeline for this user.
 * @param pin The JSON pin to delete.
 * @param callback The callback to receive the responseText after the request has completed.
 */
function deleteUserPin(pin, callback) {
    timelineRequest(pin, 'DELETE', callback);
}

/***************************** end timeline lib *******************************/
