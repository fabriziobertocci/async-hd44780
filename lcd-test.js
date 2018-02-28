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

function printClockSec(prevSec) {
    var tNow = new Date();
    if (prevSec === tNow.getSeconds()) {
        setTimeout(printClock, 100, tNow.getSeconds());
    } else {
        async.series([
            (next) => { lcd.printLine(tNow.toLocaleTimeString(), 0, next); },
            (next) => { lcd.printLine(tNow.toLocaleDateString(), 1, next); },
        ], (next) => {
            setTimeout(printClockSec, 1000-tNow.getMilliseconds(), tNow.getSeconds())
        });
    }
}

function printClockHiRes(prevDate) {
    var tNow = new Date();

    function printNow() {
        async.series([
            (next) => { lcd.printLine(tNow.toLocaleTimeString() + '.' + Math.round(tNow.getMilliseconds()/100), 0, next); },
            (next) => { lcd.printLine(tNow.toLocaleDateString(), 1, next); },
        ], (next) => {
            setTimeout(printClockHiRes, 100-(tNow.getMilliseconds()%100), tNow)
        });
    }

    if (!prevDate) {
        printNow();
        return;
    }
    var currTick = Math.round(tNow.getMilliseconds()/100);
    var prevTick = Math.round(prevDate.getMilliseconds()/100);
    var delta = Math.abs(tNow.getMilliseconds() - prevDate.getMilliseconds());
    if (delta < 100) {
        setTimeout(printClock, 100-delta, tNow);
        return;
    }
    printNow();
}

/*
async.series([
    (next) => { lcd.initialize(undefined, next); },
    (next) => { lcd.printLine("  Hello World!  ", 0, next); },
    (next) => { lcd.printLine("================", 1, next); },
]);
*/
lcd.initialize(undefined, (err) => {
    if (err) {
        console.log("LCD init failed");
        process.exit(0);
    }
    printClockSec()
});


