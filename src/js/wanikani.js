
(function() {
    'use strict';

    var WaniKani = function(apikey) {
        this.apikey = apikey;
    };

    WaniKani.prototype = {

        request: function (item, receiver) {
            var self = this,
                url = 'https://www.wanikani.com/api/user/' + this.apikey + '/' + item,
                xhr = new XMLHttpRequest();

            xhr.onload = function () {
                var response = JSON.parse(this.responseText),
                    user_information,
                    requested_information,
                    error;
                if (response) {
                    if (response.hasOwnProperty('user_information')) {
                        user_information = response.user_information;
                        user_information.apikey = self.apikey;
                    }
                    if (response.hasOwnProperty('requested_information')) {
                        requested_information = response.requested_information;
                        if (item === 'vocabulary' && requested_information.hasOwnProperty('general')) {
                            requested_information = requested_information.general;
                        }
                    }
                    if (response.hasOwnProperty('error')) {
                        /* A wanikani error is an object of with two string
                           properties: code and message. */
                        error = response.error;
                    }
                } else {
                    /* Construct an error object with the same format as a
                       wanikani error (as above). */
                    error = {
                        code: 'server_error',
                        message: responseText
                    };
                    console.log(this.responseText);
                }
                receiver(item, user_information, requested_information, error);
            };
            xhr.open('GET', url);
            xhr.send();
        }


    };

    module.exports = WaniKani;
}());
