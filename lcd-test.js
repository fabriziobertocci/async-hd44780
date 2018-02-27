'use strict';

var async = require('async');
var debug = require('debug')('lcd-test');
var lcd = require('./async-hd44780.js');

function cleanupAndExit(exitCode) {
    lcd.finalize( (err) => { process.exit(exitCode || 0) });
}



// Install signal handler to do a clean shutdown
process.on('SIGINT', () => {
    debug("Stopping...");
    setImmediate(cleanupAndExit);
});


async.series([
    (next) => { lcd.initialize(undefined, next); },
    (next) => { lcd.printLine("  Hello World!  ", 0, next); },
    (next) => { lcd.printLine("================", 1, next); },
]);


