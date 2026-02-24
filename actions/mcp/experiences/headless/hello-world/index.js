"use strict";

async function handler(args) {
  const greeting = args.name || 'World';
  const now = new Date();

  return {
    content: [{
      type: 'text',
      text: `Hello, ${greeting}! Server time: ${now.toISOString()}`
    }]
  };
}

exports.handler = handler;
