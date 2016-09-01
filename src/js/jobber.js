
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

        dequeNextJob: function () {
            var self = this;
            if (self.jobQueue.length) {
                self.activeJob = self.jobQueue.shift();
                self.activeJob(function () { self.dequeNextJob(); });
            } else {
                self.activeJob = null;
            }
        },

        enqueMessage: function (message) {
            var self = this;
            self.enqueJob(function () {
                //console.log('Send: ' + JSON.stringify(message));
                Pebble.sendAppMessage(
                    message,
                function(data) {
                    self.dequeNextJob();
                }, function(data, error) {
                    console.log('Error sending message to Pebble device: ');
                    console.log('message', JSON.stringify(message));
                    console.log('data: ', JSON.stringify(data));
                    console.log('error: ', JSON.stringify(error));
                    self.dequeNextJob();
                });
            });
        }

    };

    module.exports = Jobber;
}());
