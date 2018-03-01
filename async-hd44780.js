'use strict';

/* 
 * VIM USERS
 * ~~~~~~~~~
 *   This file contains manual folds around sections and functions for vim.
 *   To enable them, set variable 'foldmethod' to 'marker'. Then use the
 *   commands 'za'/'zc' to open/close a fold.
 * 
 *
 * DEFAULT CONFIGURATION:
 * ~~~~~~~~~~~~~~~~~~~~~
 * This is the default configuration used by the initialize() method if no
 * configuration is provided:
 *
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
 *
 */

var GPIO = require('rpi-gpio');
var async = require('async');
var debug = require('debug')('async-hd44780');

/* {{{ General Constants
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 */
const LCDCommand = {
    CLEARDISPLAY: 0x01,
    HOME: 0x02,
    ENTRYMODESET: 0x04,
    DISPLAYCONTROL: 0x08,
    CURSORSHIFT: 0x10,
    FUNCTIONSET: 0x20,
    SETCGRAMADDR: 0x40,
    SETDDRAMADDR: 0x80
};

const LCDEntryModeFlags = {
    ENTRYRIGHT: 0x00,
    ENTRYLEFT: 0x02,
    ENTRYSHIFTINCREMENT: 0x01,
    ENTRYSHIFTDECREMENT: 0x00
};

const LCDControlFlags = {
    DISPLAYON: 0x04,
    DISPLAYOFF: 0x00,
    CURSORON: 0x02,
    CURSOROFF: 0x00,
    BLINKON: 0x01,
    BLINKOFF: 0x00
};

const LCDFunctionSetFlags = {
    EIGHTBITMODE: 0x10,
    FOURBITMODE: 0x00,
    TWOLINE: 0x08,
    ONELINE: 0x00,
    FIVEBYTENDOTS: 0x04,
    FIVEBYEIGHTDOTS: 0x00
};

const LCDRowOffset = [0x00, 0x40, 0x14, 0x54];

// Value for the RS line: LCD_RS_DATA (True) = write to data, LCD_RS_CMD (False) = write to Command
const LCD_RS_DATA = true;
const LCD_RS_CMD  = false;


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

/* {{{ Global Variables
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 */
// This global object contains the current pinout and LCD geometry. Set 
// by the initalize() function. It is set to undefined after a shutdown.
var theConfig = undefined;

// This boolean is set to TRUE when a long operation (i.e. printLine) begin 
// and cleared to FALSE when it terminates. Allow to asynchronously
// shutdown the system cleanly avoiding race conditions (i.e. clearing
// theConfig object right in the middle of a sequence of writeByte() calls)
var thePendingCmd = false;          

// When there is a pending command and finalize() is called asynchronously,
// a shutdown cannot be performed until the long operation completes. Use
// theFinalize to control the type of shutdown operation (normal vs.
// clearScreen). theFinalizeCallback stores the callback to perform AFTER 
// the shutdown completes.
const FINALIZE_NONE = 0;            // No finalize after a long command
const FINALIZE_NORMAL = 1;          // Shutdown after the long command
const FINALIZE_CLEARSCREEN = 2;     // Clear screen and shutdown after the long command

var theFinalize = FINALIZE_NONE;
var theFinalizeCallback = null;

// }}}

/*******************************************************************************
 * PRIVATE FUNCTIONS
 ******************************************************************************/
/* {{{ initDefaultProperties
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Helper for initializing the configuration properties of a Javascript object.
 * It takes the argument passed in the constructor (for the properties) and
 * an Object containing the default values.
 * It returns an Object containing all the properties defined in the 'def' object
 * with the value either from the 'props' object (if defined) or from the 'def'
 * object (if unset).
 *
 * This method makes a new shallow copy of the values of the properties processed.
 */
function initDefaultProperties(props, def) {
    // props must be an object
    if (props && (typeof(props) != "object")) {
        debug("Invalid property: not an object, using defaults");
        return JSON.parse(JSON.stringify(def));
    }

    if (!props) {
        // Shortcut, if not provided, just return the default ones
        debug("Property not provided, using defaults");
        return JSON.parse(JSON.stringify(def));
    }

    // Iterate through the 'def' properties and ensure they are defined in retVal
    var retVal = {};
    for (var k in def) {
        if (props.hasOwnProperty(k)) {
            // Ensure they have the same type at least...
            if (def[k] && (typeof(props[k]) != typeof(def[k]))) {
                debug("Invalid type for property '%s', using default value", k);
            } else {
                retVal[k] = props[k];
            }
            continue;
        }
        // Use default value
        retVal[k] = def[k];
    }
    return retVal;
}

// }}}

/* {{{ shutdown
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Internal function
 *
 */
function shutdown(clear, callback) {
    function doShutdown() {
        theConfig = undefined;
        debug("Finalizing GPIO subsystem...");
        GPIO.destroy(callback);
    }

    if (clear) {
        clearScreen(doShutdown);
    } else {
        doShutdown();
    }
}

// }}}

/* {{{ delayedWrite
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Internal function
 *
 * Writes the 'value' on 'pin' after 'delay' milliseconds.
 * When the operation is completed, invokes 'callback(error)' (with error=null if
 * there are no errors).
 */
function delayedWrite(delay, pin, value, callback) {
    setTimeout( () => {
        GPIO.write(pin, value, callback);
    }, delay);
}

// }}}

/* {{{ toggleEnable
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Internal function
 *
 * Toggles the Enable pin generating a short pulse as required by the LCD 
 * after setting up each nibble on the data bus of the device.
 * When completed, invokes 'callback(null)'.
 * In case of error during the various steps, calls 'callback(error') with the
 * error.
 */
function toggleEnable(callback) {
    async.series([
        (next) => { GPIO.write(theConfig.pin_e, false, next); },
        (next) => { delayedWrite(1, theConfig.pin_e, true, next); },
        (next) => { delayedWrite(1, theConfig.pin_e, false, next); },
        (next) => { setTimeout(next, 1, null); }
    ], () => {
        if (callback) callback(null);
    });
}

// }}}

/* {{{ writeByte
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Internal function
 *
 * Writes 'bits' in the LCD setting RS line to 'mode' (boolean). 
 * The write operation will introduce a 'writeWait' delay (optional) before the
 * operation begins, and an `initWait` delay between writing the high/low nibble.
 *
 * When everything complete successfully, will call 'callback(null)'. In case of
 * error, will call 'callback(error)'.
 */
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
                        setTimeout(next, initWait);
                    } else {
                        next(null)
                    }
                  },
        (next) => { writeNibble(bits, next); },
        (next) => { toggleEnable(next); },
    ], callback);
}

// }}}



/*******************************************************************************
 * PUBLIC FUNCTIONS
 ******************************************************************************/
/* NOTE: 
 * All the public functions that perform operations on the LCD takes an optional
 * callback that is invoked after the operation completes.
 *
 * If you call finalize() while another operation is running (i.e. right in the
 * middle of a printLine(), now you have two callbacks:
 *  - the callback of the long operation (i.e. the one provided to the printLine)
 *  - the callback provided to the finalize() function
 * In this case the callback of the finalize wins and will be called after the
 * shutdown sequence is completed (after the long operation is done).
 * The callback of the original long operation call will not be invoked.
 */
/* {{{ initialize
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Public
 * 
 * Initializes the GPIO and the LCD.
 * The 'config' object defines the pinout and the geometry (rows, cols) of the 
 * LCD.
 * This object must have the following properties:
 *  'pin_rs': GPIO # where the RS pin of the LCD is connected (default=27)
 *  'pin_e' : GPIO # where the ENABLE pin of the LCD is connected (default=22)
 *  'pin_d4': GPIO # where the D4 pin of the LCD is connected (default=25)
 *  'pin_d5': GPIO # where the D5 pin of the LCD is connected (default=24)
 *  'pin_d6': GPIO # where the D6 pin of the LCD is connected (default=23)
 *  'pin_d7': GPIO # where the D7 pin of the LCD is connected (default=18)
 *  'pin_bl': GPIO # where the Backlight pin of the LCD is connected (default=15) 
 *            set it to zero (or undefined) if your LCD does not have a backlight
 *  `cols'  : number of columns in your LCD (default=16)
 *  `rows'  : number of rows in your LCD (default=2)
 */
function initialize(config, callback) {
    if (theConfig) {
        debug("LCD already initialized (ignored)");
        if (callback) callback(null);
        return;
    }
    theConfig = initDefaultProperties(config, DEFAULT_CONFIG);
    if (theConfig.rows > LCDRowOffset.length) {
        debug("Invalid row count: LCD controller only support up to %d rows", LCDRowOffset.length);
        if (callback) callback(new Error("Invalid parameter"));
        return;
    }
    theFinalize = FINALIZE_NONE;
    theFinalizeCallback = null;
    GPIO.setMode(GPIO.MODE_BCM);
    thePendingCmd = true;
    async.series([
        (next) => { debug("Setting up GPIO using config: " + JSON.stringify(theConfig)); next(null); },
        (next) => { GPIO.setup(theConfig.pin_e,  GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_rs, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d4, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d5, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d6, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_d7, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },
        (next) => { GPIO.setup(theConfig.pin_bl, GPIO.DIR_OUT, GPIO.EDGE_NONE, next) },

        (next) => { debug("Initializing LCD..."); next(null); },

        // Reset sequence
        (next) => { writeByte(0x33, LCD_RS_CMD, 0, 5, next); },
        (next) => { writeByte(0x32, LCD_RS_CMD, 0, 0, next); },

        (next) => { writeByte(LCDCommand.DISPLAYCONTROL | 
                              LCDControlFlags.DISPLAYON | 
                              LCDControlFlags.CURSOROFF | 
                              LCDControlFlags.BLINKOFF, LCD_RS_CMD, 1, 0, next); },

        (next) => { writeByte(LCDCommand.FUNCTIONSET | 
                              LCDFunctionSetFlags.FOURBITMODE | 
                              LCDFunctionSetFlags.TWOLINE | 
                              LCDFunctionSetFlags.FIVEBYEIGHTDOTS, LCD_RS_CMD, 1, 0, next); },

        (next) => { writeByte(LCDCommand.ENTRYMODESET | 
                              LCDEntryModeFlags.ENTRYLEFT |
                              LCDEntryModeFlags.ENTRYSHIFTDECREMENT, LCD_RS_CMD, 1, 0, next); },

        // Clear screen - Do not call the clearScreen() function
        (next) => { writeByte(LCDCommand.CLEARDISPLAY, LCD_RS_CMD, 1, 0, next); }, 
        (next) => { debug("LCD initialization completed successfully"); next(null); }
    ], (err) => {
        thePendingCmd = false;
        if (theFinalize) {
            // Pending asynchronous shutdown requested?
            theFinalize = FINALIZE_NONE;
            shutdown(false, theFinalizeCallback);   // don't clear the screen here
        } else {
            callback(err);
        }
    });
}

// }}}

/* {{{ finalize
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Public
 *
 * Clear the screen of the LCD and restore the GPIO state and invoke 
 * 'callback(null)'
 *
 * After calling finalize, if you want to use again the LCD you need to 
 * re-initialize it
 */
function finalize(clear, callback) {
    if (theConfig && (theFinalize === FINALIZE_NONE)) {
        if (thePendingCmd) {
            // There is a (long) scheduled command, need to execute the real
            // shutdown later, when the long operation completes
            debug("LCD delayed shutdown (pending operation)");
            theFinalize = (clearScreen ? FINALIZE_CLEARSCREEN : FINALIZE_NORMAL);
            theFinalizeCallback = callback;
        } else {
            // There are no pending sequence of operations scheduled, can shutdown
            // immediately
            debug("LCD immediate shutdown");
            shutdown(clear, callback);
        }
    } else {
        debug("LCD not initialized or already finalized, nothing to do");
        callback(null);
    }
}

// }}}

/* {{{ clearScreen
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Public
 *
 * Clears the LCD screen and call 'callback(null)' if successful, or 
 * 'callback(error)' if an error occurred.
 */
function clearScreen(callback) {
    if (!theConfig) {
        debug("clearScreen failed: LCD not initialized");
        if (callback) callback(new Error("LCD not initialized"));
        return;
    }
    debug("Clearing LCD...");
    // A single writeByte operation is not atomic and can be interrupted
    // by an asynchronous call to finalize()
    // We need to protect it just like a call to printLine()
    thePendingCmd = true;
    writeByte(LCDCommand.CLEARDISPLAY, LCD_RS_CMD, 0, 0, (err) => {
        thePendingCmd = false;
        if (theFinalize) {
            // Pending asynchronous shutdown requested?
            var clear = (theFinalize === FINALIZE_CLEARSCREEN);
            theFinalize = FINALIZE_NONE;
            shutdown(clear, theFinalizeCallback);
        } else {
            callback(err);
        }
    });
}

// }}}

/* {{{ printLine
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Public
 *
 * Prints 'message' in row 'line' (zero-based), then call 'callback(null)' or 
 * 'callback(error)' if an error occurred.
 */
function printLine(message, line, callback) {
    if (!theConfig) {
        debug("printLine failed: LCD not initialized");
        if (callback) callback(new Error("LCD not initialized"));
        return;
    }
    line = Number.parseInt(line) % theConfig.rows;
    if (message.length > theConfig.cols) {
        debug("printLine warning: message larger than display, output will be truncated");
        message = message.substr(0, theConfig.cols);
    }
    debug("Printing line '%s' on row=#%d", message, line);
    thePendingCmd = true;
    async.series([
        (next) => { writeByte(LCDCommand.SETDDRAMADDR | LCDRowOffset[line], LCD_RS_CMD, 1, 0, next); },
        (next) => { 
            async.timesSeries(message.length,
                (i, cb) => { writeByte(message.charCodeAt(i), LCD_RS_DATA, 1, 0, cb) },
                next);
        }
    ], (err) => {
        thePendingCmd = false;
        if (theFinalize) {
            // Pending asynchronous shutdown requested?
            var clear = (theFinalize === FINALIZE_CLEARSCREEN);
            theFinalize = FINALIZE_NONE;
            shutdown(clear, theFinalizeCallback);
        } else {
            callback(err);
        }
    });
}

// }}}

// Exported functions
exports.initialize  = initialize;
exports.finalize    = finalize;
exports.clearScreen = clearScreen;
exports.printLine   = printLine;
