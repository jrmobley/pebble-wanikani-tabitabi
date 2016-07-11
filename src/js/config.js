/* eslint-disable quotes */

module.exports = [
    {
        type: "heading",
        id: "main-heading",
        defaultValue: "TabiTabi",
        size: 1
    },
    {
        type: "text",
        defaultValue: "TabiTabi will update your Pebble timeline with your WaniKani kanji review schedule."
    },
    {
        type: "section",
        items: [
            {
                type: 'input',
                messageKey: 'PUBLIC_API_KEY',
                label: 'Public API Key',
                defaultValue: '',
                attributes: {
                }
            }
        ]
    },
    {
        type: 'submit',
        defaultValue: 'Save'
    }
];
