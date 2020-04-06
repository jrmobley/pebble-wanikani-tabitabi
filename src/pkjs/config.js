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
                messageKey: 'API_TOKEN',
                label: 'Personal Access Token',
                defaultValue: '',
                description: 'Your WaniKani v2 API token.',
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
