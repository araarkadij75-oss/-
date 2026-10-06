<?php
// Copy to the hosting account's private data directory, outside www.
// Never upload a populated copy into the public site directory or commit secrets.
return [
    'B2BHELP_API_TOKEN' => '',
    // Must permit server-side Identity Toolkit calls (no browser Referer header).
    'FIREBASE_WEB_API_KEY' => '',
    'FIREBASE_PROJECT_ID' => 'master-ai-beta-9440599',
    'FIREBASE_WORKSPACE_ID' => 'master-ai-beta',
    // Optional private storage files. Defaults are beside this config, outside www.
    'WEB_LEADS_FILE' => '',
    'WEB_LEAD_LIMITS_FILE' => '',
    'CRM_ALLOWED_ORIGINS' => [
        'https://araarkadij75-oss.github.io',
    ],
];
