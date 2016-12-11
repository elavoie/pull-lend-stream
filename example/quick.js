var pull = require('pull-stream')
var lendStream = require('../')

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
  mapper = mapper || function (value, cb) {
    cb(null, value)
  }

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
