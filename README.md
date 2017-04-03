[![Build Status](https://travis-ci.org/elavoie/pull-lend-stream.svg?branch=master)](https://travis-ci.org/elavoie/pull-lend-stream)

# pull-lend-stream

Continuously lends values to concurrent sub-streams. Transparent re-lending in case of failure of sub-streams.

Each sub-stream continuously borrows (different) values from a lender and returns results back after processing.

* Supports multiple concurrent sub-streams.
* Produces results in the order in which the lender reads the values.
* If a sub-stream closes before producing all its results, the original source
  values for missing results are lent transparently to other sub-streams.
* Each sub-stream obtains values as fast as they read them.

Useful for delegating processing to a dynamic number of concurrent,
cooperative, connected, but unreliable clients.

Quick Example
=============

    var pull = require('pull-stream')
    var lendStream = require('pull-lend-stream')
    
    var lender = lendStream()
    
    function minus (x, cb) {
      setTimeout(function () {
        cb(null, -x)
      }, 201)
    }
    
    // Twice faster
    function addTen (x, cb) {
      setTimeout(function () {
        cb(null, 10 + x)
      }, 100)
    }
    
    function borrower (mapper) {
      return function (err, stream) {
        if (err) return console.log(err.message)
    
        pull(
          stream,
          pull.asyncMap(mapper),
          stream
        )
      }
    }
    
    // Prints -0,11,12,-3,14,15,-6,17,18,-9,20
    pull(
      pull.count(10),
      lender,
      pull.collect(function (err, results) {
        if (err) throw err
        console.log(results)
      })
    )
    
    lender.lendStream(borrower(minus))
    lender.lendStream(borrower(addTen))


Signature
=========
    
The following signature follows the [js module signature
syntax](https://github.com/elavoie/js-module-signature-syntax) and conventions.
All callbacks ('cb') have the '(err, value)' signature.

    lendStream: () =>
    lender: {
        sink: (read: (abort, cb)),
        lendStream: (borrower: (
            err,
            subStream: {
                source: (abort, cb),
                sink: (read: (abort, resultCb)),
                close: (?err)
            })),
        source: (abort, resultCb)
    }


Properties
==========
*Italic* names refer to the function signature above.

1. If no *subStream* is read then read is never called.
2. Multiple *subStreams* can be created by calling *lendStream* multiple times.
3. Once *lendStream* has been called,  
  3.1 the borrower will eventually be called either with a *subStream* or 
    an *err*;  
  3.2 if there is no *err* and values are read by calling *subStream.source*, 
    *subStream.source* will eventually abort.
4. *lender.source* closes after *lender.sink* has received an abort and all
   *subStreams* have closed.
5. *lender.source* produces results in the order in which the values were
   read by the *lender.sink*.
6. If a *subStream* ends before successfully sinking results computed for all
   values read, then the values for missing results are transparently
   migrated to other *subStreams*.
7. Unfair: if a *subStream* reads values faster than other *subStreams*, it
   will obtain more values.
8. When a *borrower* is called, *err* is truthy if and only if:  
  8.1 *lender.sink* has not been called yet (lender is not connected to an
    upstream source);  
  8.2 *lender.source* was aborted;  
  8.3 all available values have been borrowed and all results have been sourced.
9. *subStream.close(?err)* ends the corresponding *subStream* with the error *err* if present, or with *true* otherwise.

Expectations on the sub-streams
===============================

1. Sub-streams should correctly close when *subStream.source* aborts and the
   event should propagate to their sink. Otherwise it will indefinitely prevent
   the lender from closing (Prop. 4).

Debugging
=========

You can obtain a trace of the internal events of the module by activating the logging using the `DEBUG=pull-lend-stream` environment variable (see [debug](http://npmjs.org/debug)).

You can also obtain the internal state of the module at a specific point in time by calling the `_state()` method. It returns an object with the following properties:
````
    return {
      connected: Boolean, // The lender is connecter to an upstream source
      ended: Boolean, // Upstream is closed
      closed: Boolean, // lender is closed
      openedNb: Number, // Number of sub-streams opened
      lendState: Object // State of the internal pull-lend module
    }

````

The output of the `_state()` method should not be relied on for regular operations because it depends on the implementation of the module and may change in the future.
