var tape = require('tape')
var pull = require('pull-stream')
var lendStream = require('../')
var debug = require('debug')
var log = debug('test')
var setImmediate = require('async.util.setimmediate')

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

tape('Property 3.2', function (t) {
  var lender = lendStream()
  var N = 100

  var closed = false
  function noOpBorrower (err, stream) {
    if (err) t.false(err)
    if (closed) t.false(closed)

    pull(
      stream,
      pull.asyncMap(function (value, cb) {
        setImmediate(function () {
          cb(null, value)
        })
      }),
      stream
    )
  }

  pull(
    pull.count(10),
    lender,
    pull.collect(function (err, results) {
      t.false(err)
      closed = true
      t.end()
    })
  )

  for (var i = 0; i < N; ++i) {
    lender.lendStream(noOpBorrower)
  }
})

