# async-hd44780
An asynchronous javascript library to control a LCD based on the Hitachi HD44780 controller.

The [Hitachi HD44780](https://en.wikipedia.org/wiki/Hitachi_HD44780_LCD_controller) is an alphanumeric dot matrix LCD controller developed by Hitachi that was (and still) commonly used in various alphanumeric displays like the following:
* [Sunfounder LCD 2004 Module](https://www.sunfounder.com/lcd2004-module.html)
* [Adafruit standard 16x2 LCD](https://www.adafruit.com/product/181)
* (and many others)

This project is based on the Python code from the [Adafruit_Python_CharLCD](https://github.com/adafruit/Adafruit_Python_CharLCD). 
It is ported to node.js and uses the [James Barrel's rpi-gpio](https://github.com/JamesBarwell/rpi-gpio.js) library for low-level GPIO access.

The code is entirely asynchronous and best suited for JS project where you cannot block the main event loop. It extensively make use of the [Async](https://caolan.github.io/async/) library to ensure the correct sequence of operations. 

## Getting Started
```
npm install async-hd44780
```

## Usage
[TODO]
