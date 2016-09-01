
(function() {
    'use strict';

    var WaniKani = function(apikey) {
        this.apikey = apikey;
    };

    WaniKani.prototype = {

        request: function (item, handler) {
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


    };

    module.exports = WaniKani;
}());
