'use strict';

/*
 *    Pin   LCD  DESCRIPTION             REMARKS
 * ---------------------------------------------------------
 *     6     1   VSS (GND)
 *     2     2   VDD (5V)
 *           3   Contrast (0-5V)
 *    13     4   RS (Register Select)    GPIO 27
 *     6     5   R/W (Read Write)        GROUND THIS PIN
 *    15     6   Enable or Clock         GPIO 22
 *           7   Data Bit 0              NOT USED
 *           8   Data Bit 1              NOT USED
 *           9   Data Bit 2              NOT USED
 *          10   Data Bit 3              NOT USED
 *    22    11   Data Bit 4              GPIO 25
 *    18    12   Data Bit 5              GPIO 24
 *    16    13   Data Bit 6              GPIO 23
 *    12    14   Data Bit 7              GPIO 18
 *     2    15   LCD Backlight +5V       (only for models with backlight)
 *     6    16   LCD Backlight GND       (only for models with backlight)
 */

var GPIO = require('rpi-gpio');
var async = require('async');
var debug = require('debug')('async-hd44780');

/* {{{ General Constants
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 */
const command = {
    CLEARDISPLAY: 0x01,
    HOME: 0x02,
    ENTRYMODESET: 0x04,
    DISPLAYCONTROL: 0x08,
    CURSORSHIFT: 0x10,
    FUNCTIONSET: 0x20,
    SETCGRAMADDR: 0x40,
    SETDDRAMADDR: 0x80
};

const entryModeFlags = {
    ENTRYRIGHT: 0x00,
    ENTRYLEFT: 0x02,
    ENTRYSHIFTINCREMENT: 0x01,
    ENTRYSHIFTDECREMENT: 0x00
};

const controlFlags = {
    DISPLAYON: 0x04,
    DISPLAYOFF: 0x00,
    CURSORON: 0x02,
    CURSOROFF: 0x00,
    BLINKON: 0x01,
    BLINKOFF: 0x00
};

const functionSetFlags = {
    EIGHTBITMODE: 0x10,
    FOURBITMODE: 0x00,
    TWOLINE: 0x08,
    ONELINE: 0x00,
    FIVEBYTENDOTS: 0x04,
    FIVEBYEIGHTDOTS: 0x00
};

const ROWOFFSETS = [0x00, 0x40, 0x14, 0x54];

const LCD_CHR = true;
const LCD_CMD = false;

// Default configuration (with default GPIO Mapping)
const DEFAULT_CONFIG = {
    pin_rs: 27,
    pin_e: 22,
    pin_d4: 25,
    pin_d5: 24,
    pin_d6: 23,
    pin_d7: 18,
    pin_bl: 15,     // Backlight pin
    cols: 16,
    rows: 2
}
// }}}

var theConfig = undefined;

function delayedWrite(delay, pin, value, callback) {
    setTimeout( () => {
        GPIO.write(pin, value, callback);
    }, delay);
}


function toggleEnable(callback) {
    async.series([
        (next) => { GPIO.write(theConfig.pin_e, false, next); },
        (next) => { delayedWrite(1, theConfig.pin_e, true, next); },
        (next) => { delayedWrite(1, theConfig.pin_e, false, next); },
        (next) => { setTimeout(next, 1); }
    ], callback);
}

function writeByte(bits, mode, writeWait, initWait, callback) {
    function writeNibble(val, cb) {
        async.parallel([
            (next) => { GPIO.write(theConfig.pin_d4, ((val & 0x01) == 0x01), next); },
            (next) => { GPIO.write(theConfig.pin_d5, ((val & 0x02) == 0x02), next); },
            (next) => { GPIO.write(theConfig.pin_d6, ((val & 0x04) == 0x04), next); },
            (next) => { GPIO.write(theConfig.pin_d7, ((val & 0x08) == 0x08), next); },
        ], cb);
    }

    async.series([
        (next) => { delayedWrite(writeWait, theConfig.pin_rs, mode, next); },
        (next) => { writeNibble(bits >> 4, next); },
        (next) => { toggleEnable(next); },
        (next) => { if (initWait) {
                        setTimeout(() => next(null), initWait); 
                    } else {
                        next(null)
                    }
                  },
        (next) => { writeNibble(bits, next); },
        (next) => { toggleEnable(next); },
    ], callback);
}

function initialize(config, callback) {
    if (theConfig) {
        debug("LCD already initialized (ignored)");
        if (callback) callback(null);
        return;
    }
    theConfig = config || DEFAULT_CONFIG;
    if (theConfig.rows > ROWOFFSETS.length) {
        debug("Invalid row count");
        if (callback) callback(new Error("Invalid parameter"));
        return;
    }
    GPIO.setMode(GPIO.MODE_BCM);
    async.series([
        (next) => { debug("Setting up GPIO..." + JSON.stringify(theConfig)); next(null); },
        (next) => { GPIO.setup(theConfig.pin_e,  GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_rs, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d4, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d5, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d6, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d7, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_bl, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },

        (next) => { debug("Initializing LCD..."); next(null); },
        (next) => { writeByte(0x33, LCD_CMD, 0, 5, next); }, // 110011 Initialise
        (next) => { writeByte(0x32, LCD_CMD, 0, 0, next); }, // 110010 Initialise
        (next) => { writeByte(0x06, LCD_CMD, 1, 0, next); }, // 000110 Cursor move direction
        (next) => { writeByte(0x0C, LCD_CMD, 1, 0, next); }, // 001100 Display On,Cursor Off, Blink Off
        (next) => { writeByte(0x28, LCD_CMD, 1, 0, next); }, // 101000 Data length, number of lines, font size
        clearScreen
    ], (err) => {
        if (err) {
            debug("Failed to initialize LCD: " + err);
            callback(err);
        }
        debug("LCD initialization completed successfully");
        if (callback) callback(null);
    });
}

function finalize(callback) {
    if (theConfig) {
        // Clear only if initialized
        debug("Finalizing GPIO subsystem...");
        clearScreen((err) => { theConfig = undefined; GPIO.destroy(callback) })
    } else {
        debug("LCD not initialized");
    }
}

function clearScreen(callback) {
    if (!theConfig) {
        debug("LCD not initialized");
        if (callback) callback(new Error("not configured"));
        return;
    }
    debug("Clearing LCD");
    writeByte(command.CLEARDISPLAY, LCD_CMD, 0, 0, callback); // 000001 Clear display
}

function printLine(message, line, callback) {
    if (!theConfig) {
        debug("LCD not initialized");
        if (callback) callback(new Error("not configured"));
        return;
    }
    line = Number.parseInt(line) % theConfig.rows;
    if (message.length > theConfig.cols) {
        debug("Message too long, line will be truncated");
        message = message.substr(0, theConfig.cols);
    }
    debug("Printing line '%s' on row=#%d", message, line);
    async.series([
        (next) => { writeByte(command.SETDDRAMADDR | ROWOFFSETS[line], LCD_CMD, 1, 0, next); },
        (next) => { 
            async.timesSeries(message.length,
                (i, cb) => { writeByte(message.charCodeAt(i), LCD_CHR, 1, 0, cb) },
                next);
        }
    ], callback);
}

exports.initialize  = initialize;
exports.finalize    = finalize;
exports.printLine   = printLine;
