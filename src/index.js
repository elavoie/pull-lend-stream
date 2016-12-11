var lend = require('pull-lend')

module.exports = function () {
  var closed = false
  var lender = lend()

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
          cb(abort = _abort)
          close(abort)
          return
        }

        lender.lend(function (err, value, sink) {
          if (err) return cb(closed = err)

          queue.push(sink)
          cb(null, value)
        })
      },
      sink: function (read) {
        read(abort, function next (err, result) {
          if (err) return close(err)

          if (queue.length > 0) {
            var sink = queue.shift()
            sink(null, result)
          }

          read(abort, next)
        })
      }
    }
  }

  return {
    source: lender.source,
    sink: lender.sink,
    lendStream: function (borrower) {
      if (closed) return borrower(closed)

      borrower(closed, createSubStream())
    }
  }
}
