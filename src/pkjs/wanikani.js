
var _ = require('underscore');

(function() {
    'use strict';

    var WaniKani = function(token) {
        this.token = token;
    };

    WaniKani.prototype = {

        request: function (endpoint, onData, onError) {
            var url = 'https://api.wanikani.com/v2/' + endpoint,
                xhr = new XMLHttpRequest();
            
            xhr.onload = function () {
                var response = JSON.parse(this.responseText);
                if (response) {
                    if (_.has(response, 'data')) {
                        onData(response.data);
                        return;
                    }
                    if (_.has(response, 'error')) {
                        onError(response.error.message);
                        return;
                    }
                }
                
                onError(this.status + ' ' + this.statusText.toString());
            };

            console.log('GET ' + url);
            xhr.open('GET', url);
            xhr.setRequestHeader('Wanikani-Revision', '20170710');
            xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
            xhr.send();
        }

    };

    module.exports = WaniKani;
}());
