
/*global
    $: false,
    console: false,
    window: false,
    location: false
*/

var options;

function loadOptions() {
    'use strict';
    var encodedOptions = window.location.hash.substring(1),
        jsonOptions = decodeURIComponent(encodedOptions);

    try {
        options = JSON.parse(jsonOptions);
    } catch (ex) {
        options = {};
    }
    console.log('options: ' + JSON.stringify(options));
    if (options.apikey === undefined) {
        options.apikey = '';
    }

    $('#api-key-input').val(options.apikey);
}

(function () {
    'use strict';
    loadOptions();
})();

function getQueryParam(variable, defaultValue) {
    'use strict';
    // Find all URL parameters
    var query = location.search.substring(1),
        vars = query.split('&'),
        i,
        pair;
    for (i = 0; i < vars.length; i++) {
        pair = vars[i].split('=');

        // If the query variable parameter is found, decode it to use and return it for use
        if (pair[0] === variable) {
            return decodeURIComponent(pair[1]);
        }
    }
    return defaultValue || false;
}

$().ready(function () {
    'use strict';
    var platform = getQueryParam('platform', 'aplite'),
        version = getQueryParam('version', '1.1'),
        returnTo = getQueryParam('return_to', 'pebblejs://close#');

    $('#b-cancel').on('click', function () {
        console.log('Cancel');
        location.href = returnTo;
    });

    $('#b-submit').on('click', function () {
        console.log('Submit');
        var options = {
                'apikey': $('#api-key-input').val()
            },
            jsonOptions = JSON.stringify(options),
            encodedOptions = encodeURIComponent(jsonOptions),
            url = returnTo + encodedOptions;
        console.log('Return options: ' + jsonOptions);
        console.log('Return to: ' + url);
        location.href = url;
    });

    $('#version').text(version);

});
