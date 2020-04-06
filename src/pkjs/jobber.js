'use strict';
/*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
/*global Pebble */

(function() {
    'use strict';

    var Jobber = function() {
        this.jobQueue = [];
        this.activeJob = null;
    };

    Jobber.prototype = {

        enqueJob: function (job) {
            this.jobQueue.push(job);
        },

        start: function () {
            var self = this;
            if (self.activeJob == null && self.jobQueue.length) {
                self.dequeNextJob();
            }
        },

        dequeNextJob: function () {
            var self = this;
            if (self.jobQueue.length) {
                self.activeJob = self.jobQueue.shift();
                self.activeJob(
                    function () { self.dequeNextJob(); }, // next
                    function () { self.cancelAllJobs(); } // abort
                );
            } else {
                self.activeJob = null;
            }
        },

        cancelAllJobs: function () {
            var self = this;
            self.jobQueue = [];
            self.activeJob = null;
        },

        enqueMessage: function (message, log) {
            var self = this;
            self.enqueJob(function (next, abort) {
                if (log) {
                    console.log(log);
                }
                Pebble.sendAppMessage(
                    message,
                function(_data) {
                    next();
                }, function(data, error) {
                    console.log('Error sending message to Pebble device: ');
                    console.log('message', JSON.stringify(message));
                    console.log('data: ', JSON.stringify(data));
                    console.log('error: ', JSON.stringify(error));
                    abort();
                });
            });
        }

    };

    module.exports = Jobber;
}());
