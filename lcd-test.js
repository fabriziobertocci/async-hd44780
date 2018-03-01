'use strict';

var async = require('async');
var lcd = require('./async-hd44780.js');

var theCurrentTimeout = undefined;


// Install signal handler to do a clean shutdown
process.on('SIGINT', () => {
    if (theCurrentTimeout) clearTimeout(theCurrentTimeout);
    lcd.finalize(true, (err) => { 
        process.exit(0);
    });
});

function printClockSec(prevSec) {
    var tNow = new Date();
    if (prevSec === tNow.getSeconds()) {
        theCurrentTimeout = setTimeout(() => {
            theCurrentTimeout = undefined;
            printClockSec(tNow.getSeconds());
        }, 100);
    } else {
        async.series([
            (next) => { lcd.printLine(tNow.toLocaleTimeString(), 0, next); },
            (next) => { lcd.printLine(tNow.toLocaleDateString(), 1, next); },
        ], (next) => {
            theCurrentTimeout = setTimeout(() => {
                theCurrentTimeout = undefined;
                printClockSec(tNow.getSeconds());
            }, 1000-tNow.getMilliseconds())
        });
    }
}

/*
function printClockHiRes(prevDate) {
    var tNow = new Date();

    function printNow() {
        async.series([
            (next) => { lcd.printLine(tNow.toLocaleTimeString() + 
                                      '.' + Math.round(tNow.getMilliseconds()/100), 0, next); },
            (next) => { lcd.printLine(tNow.toLocaleDateString(), 1, next); },
        ], (next) => {
            theCurrentTimeout = setTimeout(() => {
                theCurrentTimeout = undefined;
                printClockHiRes(tNow);
            }, 100-(tNow.getMilliseconds()%100))
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
        theCurrentTimeout = setTimeout(() => {
            theCurrentTimeout = undefined;
            printClock(tNow);
        }, printClock, 100-delta);
        return;
    }
    printNow();
}
*/

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


