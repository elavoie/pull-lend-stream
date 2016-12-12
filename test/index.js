var tape = require('tape')
var pull = require('pull-stream')
var lendStream = require('../')
var debug = require('debug')
var log = debug('test')
var setImmediate = require('async.util.setimmediate')
var buffer = require('pull-eager-buffer')
var limit = require('pull-limit')

;(function () {
  var seed = 49734321
  function random () {
    // Robert Jenkins' 32 bit integer hash function.
    seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff
    seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff
    seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff
    seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff
    seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff
    seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff
    return seed
  }

  Math.random = function () {
    return Math.abs(random() / 0x7fffffff)
  }

  Math.seed = function (s) {
    if (arguments.length === 1 && typeof s === 'number') {
      seed = s
    } else {
      seed = 49734321
    }
  }
})()

function delay (ms) {
  return pull.asyncMap(function (value, cb) {
    if (ms) {
      setTimeout(function () {
        cb(null, value)
      }, ms)
    } else {
      setImmediate(function () {
        cb(null, value)
      })
    }
  })
}

tape('Transparent no-op streaming', function (t) {
  var lender = lendStream()
  var expected = [0, 1, 2]

  pull(
    pull.count(2),
    lender,
    pull.collect(function (err, results) {
      t.false(err)
      t.deepEqual(results, expected)
      t.end()
    })
  )

  lender.lendStream(function (err, stream) {
    t.false(err)
    pull(
      stream,
      stream
    )
  })
})

tape('Property 1', function (t) {
  var lender = lendStream()
  var read = []
  var N = 10

  pull(
    pull.count(),
    pull.through(function (x) { read.push(x) }),
    lender,
    pull.drain()
  )

  var started = 0
  function borrower (err, stream) {
    if (err) t.false(err)
    if (++started === 10) {
      t.equal(read.length, 0)
      t.end()
    }
  }

  for (var i = 0; i < N; ++i) {
    lender.lendStream(borrower)
  }
})

tape('Property 2', function (t) {
  var lender = lendStream()
  var expected = [-0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10]

  function minus (x, cb) {
    setTimeout(function () {
      cb(null, -x)
    }, 50)
  }

  function asyncMap (mapper) {
    var seen = []
    function borrower (err, stream) {
      if (err) t.false(err)

      pull(
        stream,
        pull.through(function (x) { seen.push(x) }),
        pull.asyncMap(mapper),
        stream
      )
    }

    borrower.seen = seen
    return borrower
  }

  var b1 = asyncMap(minus)
  var b2 = asyncMap(minus)

  pull(
    pull.count(10),
    lender,
    pull.collect(function (err, results) {
      t.false(err)
      t.true(b1.seen.length > 0)
      t.true(b2.seen.length > 0)
      t.true(b1.seen.length + b2.seen.length === 11)
      log('b1 saw values: ' + b1.seen)
      log('b2 saw values: ' + b2.seen)
      t.deepEqual(results, expected)
      t.end()
    })
  )

  lender.lendStream(b1)
  lender.lendStream(b2)
})

tape('Property 3 & 4', function (t) {
  Math.seed()

  var lender = lendStream()
  var N = 100

  function closing (closingCb) {
    return function (read) {
      return function (abort, cb) {
        read(abort, function (err, value) {
          if (err) {
            closingCb(err)
            return cb(err)
          }
          cb(null, value)
        })
      }
    }
  }

  var lent = 0
  var doneWithErr = 0
  var doneWithClose = 0
  function noopBorrower (err, stream) {
    if (err) return doneWithErr++

    pull(
      stream,
      closing(function () {
        doneWithClose++
      }),
      delay(),
      stream
    )
  }

  pull(
    pull.count(3),
    lender,
    pull.collect(function (err, results) {
      t.false(err)
      log('after stream closed')
      log('lent: ' + lent)
      log('done with an error: ' + doneWithErr)
      log('done with a subStream close: ' + doneWithClose)
      t.equal(doneWithErr + doneWithClose, N)

      lender.lendStream(function (err) {
        t.true(err, 'any future lendStream() returns an err')
      })

      t.end()
    })
  )

  for (var i = 0; i < N; ++i) {
    lent++
    setImmediate(function () {
      lender.lendStream(noopBorrower)
    })
  }
})

tape('Property 5', function (t) {
  Math.seed()

  var lender = lendStream()
  var N = 1000

  var values = []
  for (var i = 0; i < 10000; i++) {
    values.push(i)
  }

  function noopBorrower (err, stream) {
    if (err) return

    pull(
      stream,
      delay(Math.random() * 50),
      stream
    )
  }

  pull(
    pull.values(values),
    lender,
    pull.collect(function (err, results) {
      t.false(err)
      t.deepEqual(results, values)
      t.end()
    })
  )

  for (var j = 0; j < N; ++j) {
    lender.lendStream(noopBorrower)
  }
})

tape('Property 6', function (t) {
  Math.seed()
  var lender = lendStream()

  var values = []
  for (var i = 0; i < 2000; i++) {
    values.push(i)
  }

  function faultyBorrower (N) {
    var i = 0
    return function (err, stream) {
      if (err) t.false(err)

      if (N === 0) {
        stream.source(true, function () {
          pull(
            stream,
            stream
          )
        })
        return
      }

      pull(
        stream,
        pull.asyncMap(function (value, cb) {
          if (i++ >= N) {
            return cb(true)
          }
          cb(null, value)
        }),
        delay(Math.random() * 50),
        stream
      )
    }
  }

  function noopBorrower (err, stream) {
    if (err) t.false(err)
    pull(
      stream,
      delay(Math.random() * 50),
      stream
    )
  }

  pull(
    pull.values(values),
    lender,
    pull.collect(function (err, results) {
      t.false(err)
      t.deepEqual(results, values)
      t.end()
    })
  )

  for (var j = 0; j < 200; ++j) {
    setTimeout(function () {
      lender.lendStream(faultyBorrower(0))
    }, Math.random() * 100)
    setTimeout(function () {
      lender.lendStream(faultyBorrower(1))
    }, Math.random() * 100)
    setTimeout(function () {
      lender.lendStream(faultyBorrower(2))
    }, Math.random() * 100)
    setTimeout(function () {
      lender.lendStream(faultyBorrower(3))
    }, Math.random() * 100)
    setTimeout(function () {
      lender.lendStream(noopBorrower)
    }, Math.random() * 100)
  }
})

tape('Property 7: fast, medium, slow', function (t) {
  var lender = lendStream()
  var N = 100

  function createBorrower (nPerSec) {
    function borrower (err, stream) {
      if (err) t.false(err)
      pull(
        stream,
        pull.through(function () { borrower.count++ }),
        delay((1 / nPerSec) * 1000),
        stream
      )
    }
    borrower.count = 0
    return borrower
  }

  pull(
    pull.count(N),
    lender,
    pull.drain(null, function () {
      log('fast: ' + fast.count)
      log('medium: ' + medium.count)
      log('slow: ' + slow.count)
      t.equal(fast.count + medium.count + slow.count, N + 1)
      t.true((fast.count > medium.count) && (medium.count > slow.count))
      t.end()
    })
  )

  var fast = createBorrower(400)
  var medium = createBorrower(200)
  var slow = createBorrower(100)

  lender.lendStream(fast)
  lender.lendStream(medium)
  lender.lendStream(slow)
})

tape('Property 7: greedy eager buffer', function (t) {
  var lender = lendStream()
  var N = 1000

  function createEagerBorrower () {
    var b = buffer()
    function borrower (err, stream) {
      t.false(err)

      pull(
        stream,
        pull.through(function () { borrower.count++ }),
        b,
        stream
      )
    }
    borrower.count = 0

    return borrower
  }

  function createBorrower (nPerSec) {
    function borrower (err, stream) {
      if (err) return

      pull(
        stream,
        pull.through(function () { borrower.count++ }),
        delay((1 / nPerSec) * 1000),
        stream
      )
    }
    borrower.count = 0
    return borrower
  }

  pull(
    pull.count(N),
    lender,
    pull.drain(null, function () {
      log('b100: ' + b100.count)
      log('eager: ' + eager.count)
      t.equal(b100.count, 0)
      t.equal(eager.count, N + 1)
      t.end()
    })
  )

  var b100 = createBorrower(100)
  var eager = createEagerBorrower()

  lender.lendStream(eager)
  lender.lendStream(b100)
})

tape('Property 8.1 & 8.2', function (t) {
  var lender = limit(lendStream())

  lender.lendStream(function (err) {
    t.true(err)
  })

  var i = 0
  function read (abort, cb) {
    log('read(' + abort + ',' + (typeof cb) + ')')
    if (abort) return cb(abort)

    var value = i++
    log('returning ' + value)
    cb(null, value)
  }

  lender.sink(read)

  function noopBorrower (err, stream) {
    if (err) t.false(err)
    pull(
      stream,
      stream
    )
  }

  lender.lendStream(noopBorrower)

  lender.source(null, function (err, value) {
    t.false(err)
    t.equal(value, 0)

    lender.source(null, function (err, value) {
      t.false(err)
      t.equal(value, 1)

      lender.source(true, function (err) {
        t.true(err)

        lender.lendStream(function (err) {
          t.true(err)
          t.end()
        })
      })
    })
  })
})

tape('Property 8.3', function (t) {
  var lender = limit(lendStream())

  lender.lendStream(function (err) {
    t.true(err)
  })

  var i = 0
  function read (abort, cb) {
    log('read(' + abort + ',' + (typeof cb) + ')')
    if (abort) return cb(abort)

    if (i >= 2) {
      log('upstream source closing')
      return cb(true)
    }

    var value = i++
    log('returning ' + value)
    cb(null, value)
  }

  lender.sink(read)

  function noopBorrower (err, stream) {
    if (err) t.false(err)
    pull(
      stream,
      stream
    )
  }

  lender.lendStream(noopBorrower)

  lender.source(null, function (err, value) {
    t.false(err)
    t.equal(value, 0)

    lender.source(null, function (err, value) {
      t.false(err)
      t.equal(value, 1)

      lender.source(null, function (err, value) {
        t.true(err)

        lender.lendStream(function (err) {
          t.true(err)
          t.end()
        })
      })
    })
  })
})
