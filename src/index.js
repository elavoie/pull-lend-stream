var lend = require('pull-lend')
var debug = require('debug')

module.exports = function () {
  var connected = false // The lender sink is connected
  var ended = false // No more value to read
  var closed = false // This lender is closed
  var opened = 0 // Number of subStreams still opened
  var lender = lend()
  var _cb = null
  var log = debug('pull-lend-stream')

  function createSubStream () {
    var queue = []
    var abort = false // source aborted

    function close (abort) {
      if (abort) {
        queue.forEach(function (sink) {
          sink(abort)
        })
      }
    }
    return {
      source: function (_abort, cb) {
        if (_abort) {
          if (cb) cb(abort = _abort)
          close(abort)
          return
        }

        lender.lend(function (err, value, sink) {
          if (err) return cb(ended = err)

          queue.push(sink)
          cb(null, value)
        })
      },
      sink: function (read) {
        opened++
        log('opened sub-stream, ' + opened + ' currently opened in total')
        read(abort, function next (err, result) {
          if (err) {
            close(err)
            opened--
            log('closing sub-stream, ' + opened + ' still opened')
            closeLender()
            return
          }

          if (queue.length > 0) {
            var sink = queue.shift()
            sink(null, result)
          }

          read(abort, next)
        })
      }
    }
  }

  function closeLender () {
    if (_cb && closed && opened === 0) {
      log('closing lender')
      var cb = _cb
      _cb = null
      cb(closed)
    }
  }

  return {
    sink: function (read) {
      connected = true
      lender.sink(read)
    },
    lendStream: function (borrower) {
      log('lendStream(' + (typeof borrower) + ')')
      log('connected: ' + connected +
        ', ended: ' + ended +
        ', closed: ' + closed +
        ', opened: ' + opened)
      if (!connected) return borrower(new Error('not connected'))
      if (ended) return borrower(ended)

      borrower(ended, createSubStream())
    },
    source: function (abort, cb) {
      if (abort) log('source(' + abort + ')')
      lender.source(abort, function (err, data) {
        if (err) {
          log('lender.source.cb(' + err + ')')
          ended = closed = err
          _cb = cb
          return closeLender()
        }
        cb(null, data)
      })
    }
  }
}
