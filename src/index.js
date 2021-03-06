var lend = require('pull-lend')
var debug = require('debug')

module.exports = function () {
  var connected = false // The lender sink is connected
  var ended = false // No more value to read
  var closed = false // This lender is closed
  var aborted = false // Aborted from downstream
  var opened = 0 // Number of subStreams still opened
  var lender = lend()
  var _cb = null
  var log = debug('pull-lend-stream')

  function createSubStream () {
    var queue = []
    var abort = false // source aborted
    var pending = null

    function close (abort) {
      if (abort) {
        if (pending) {
          var cb = pending
          pending = null
          cb(abort)
        }
        var q = queue.slice()
        log('terminating ' + q.length + ' pending callbacks')
        queue = []
        q.forEach(function (sink) {
          sink(abort)
        })
      }
    }

    function source (_abort, cb) {
      if (abort || _abort) {
        log('sub-stream abort: ' + _abort)
        abort = abort || _abort
        close(abort)
        if (cb) cb(abort)
        return
      }

      pending = cb
      lender.lend(function (err, value, sink) {
        if (err) {
          log('lender.lend(' + err + ', ...)')
          if (pending) {
            cb = pending
            pending = null
            cb(ended = err)
          }
        } else if (abort || closed) {
          sink(abort || closed)
          if (pending) {
            cb = pending
            pending = null
            cb(abort || closed)
          }
        } else {
          queue.push(sink)
          if (pending !== cb) throw new Error('Invalid pending callback')
          pending = null
          cb(null, value)
        }
      })
    }
    return {
      source: source,
      sink: function (read) {
        opened++
        log('opened sub-stream, ' + opened + ' currently opened in total')
        read(abort || aborted, function next (err, result) {
          if (err) {
            close(err)
            opened--
            if (opened < 0) throw new Error('Callback called more than once')
            log('closing sub-stream, ' + opened + ' still opened')
            closeLender()
            return
          }

          if (queue.length > 0) {
            var sink = queue.shift()
            sink(null, result)
          }

          read(abort || aborted, next)
        })
      },
      close: function (err) {
        err = err || true
        source(err)
        close(err)
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

  function state () {
    return {
      connected: connected,
      ended: ended,
      closed: closed,
      openedNb: opened,
      lendState: lender._state()
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
      aborted = abort
      lender.source(abort, function (err, data) {
        if (err) {
          log('lender.source.cb(' + err + ')')
          ended = closed = err
          _cb = cb
          return closeLender()
        }
        cb(null, data)
      })
    },
    _state: state
  }
}
