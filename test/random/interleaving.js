var path = require('path')
var LendStream = require(path.join(__dirname, '..', '..'))
var pull = require('pull-stream')
var log = require('debug')('interleaving')
var logActions = require('debug')('interleaving:actions')
var checker = require('pull-stream-protocol-checker')

var seed = 49734321
function randomInt () {
  // Robert Jenkins' 32 bit integer hash function.
  seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff
  seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff
  seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff
  seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff
  seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff
  seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff
  return seed
}

function random () {
  return Math.abs(randomInt() / 0x7fffffff)
}

function interleaving (options) {
  options = options || {}

  var count = (typeof options.count !== 'undefined') ? options.count : 1
  log('count: ' + count)

  var maxSubStreams = options.maxSubStreams || 20

  var parallelism = options.parallelism || 1
  log('parallelism: ' + parallelism)

  var startingSeed
  if (options.hasOwnProperty('seed')) {
    startingSeed = options.seed
  } else {
    startingSeed = Math.round(Math.random() * Math.pow(2, 31))
  }
  log('seed: ' + startingSeed)
  seed = startingSeed

  // If true, input terminates the stream (normal sequence),
  // otherwise output terminates the stream (early termination)
  var isNormalSequence = ((typeof options.normalSequence !== 'undefined')
    ? options.normalSequence
    : (random() * 2) > 1)
  log('normal sequence: ' + isNormalSequence)

  // If true, terminates normally (done, or abort),
  // otherwise, terminates with an error (error or fail)
  var isNormalTermination = ((typeof options.normalTermination !== 'undefined')
    ? options.normalTermination
    : (random() * 2) > 1)
  log('normal termination: ' + isNormalTermination)

  var inputNb
  var outputNb
  if (isNormalSequence) {
    inputNb = count
    outputNb = +Infinity
  } else {
    inputNb = +Infinity
    outputNb = count
  }
  log('inputNb: ' + inputNb)
  log('outputNb: ' + outputNb)

  var valueIndex = 0
  var subStreamIndex = 0
  var pendingInput = null
  var activeSubStreamNb = 0
  var outputDone = false
  var outputValues = []

  var actions = {
    input: {},
    output: {},
    lender: {},
    subStream: {}
  }

  var active = {
    input: {},
    output: {},
    lender: {},
    subStream: {}
  }

  var input = (function () {
    var index = 0
    active.input.next = false
    return function input (abort, cb) {
      var j = ++index
      if (abort) {
        active.input.next = false
        log('-> I:abort_' + j)
        var status = abort instanceof Error ? 'error' : 'done'
        if (pendingInput) {
          var pending = pendingInput
          pendingInput = null
          log('I:' + status + '_' + (j - 1))
          pending(abort)
        }
        log('I:' + status + '_' + j)
        return cb(abort)
      } else {
        log('-> I:ask_' + j)

        actions.input.next = function () {
          if (pendingInput) pendingInput = null
          active.input.next = false
          if (valueIndex < inputNb) {
            var v = ++valueIndex
            log('I:value_' + j + '(' + v + ')')
            return cb(null, v)
          } else if (isNormalTermination) {
            log('I:done_' + j)
            return cb(true)
          } else {
            log('I:error_' + j)
            cb(new Error('error'))
          }
        }

        if (valueIndex < inputNb) {
          active.input.next = true
        } else if (isNormalSequence) {
          active.input.next = true
        }
        pendingInput = cb
      }
    }
  })()

  function output () {
    var index = 0
    return function (read) {
      actions.output.next = function next () {
        function answer (done, x) {
          if (done) {
            var status = done instanceof Error ? 'error' : 'done'
            log('-> O:' + status + '_' + i)
            active.output.next = false
            active.lender.createSubStream = false
            probeIn.terminate()
            probeOut.terminate()
            outputDone = true
          } else {
            log('-> O:value_' + i + '(' + x + ')')
            outputValues.push(x)
            active.output.next = true
          }
        }

        var i = ++index
        active.output.next = false

        if (i <= outputNb) {
          log('O:ask_' + i)
          read(null, answer)
        } else if (isNormalTermination) {
          log('O:abort_' + i)
          read(true, answer)
        } else {
          log('O:fail_' + i)
          read(new Error('error'), answer)
        }
      }
      active.output.next = true
    }
  }

  active.lender.createSubStream = true
  actions.lender.createSubStream = function createSubStream () {
    if (subStreamIndex >= maxSubStreams) {
      console.error('Maximum number of substream creation reached, aborting')
      console.error('seed used: ' + startingSeed)
      process.exit(1)
    }

    lender.lendStream(function (err, s) {
      if (err) {
        log('lendStream error: ' + err.message)
        return
      }

      var index = ++subStreamIndex
      activeSubStreamNb++
      log('created S[' + index + ']')

      if (activeSubStreamNb >= parallelism) {
        active.lender.createSubStream = false
      }

      var subStreamActions = {
        input: {},
        output: {}
      }
      actions.subStream[index] = subStreamActions
      active.subStream[index] = {
        input: {
          ask: true,
          abort: true,
          fail: true
        },
        output: {
          value: false,
          done: false,
          error: false
        }
      }

      var outputValues = []
      var outputCb = null
      var inputDone = false

      function destroySubStream (i) {
        log('destroyed S[' + i + ']')
        activeSubStreamNb--
        if (!outputDone && activeSubStreamNb < parallelism) {
          active.lender.createSubStream = true
        }
        delete active.subStream[i]
        delete actions.subStream[i]
        probeIn.terminate()
        probeOut.terminate()
      }

      function transformer (read) {
        var inputIndex = 0
        var outputIndex = 0
        subStreamActions.input.ask = function () {
          var n = ++inputIndex
          log('S[' + index + ']I:ask_' + n)
          active.subStream[index].input.ask = false
          read(false, function (done, x) {
            var status
            if (!active.subStream.hasOwnProperty(index)) {
              status = done ? 'terminated' : 'value'
              log('WARNING: substream[' + index + '] obtained a ' + status + ' answer after being destroyed')
              return
            }

            if (done) {
              inputDone = true
              status = done instanceof Error ? 'error' : 'done'
              log('-> S[' + index + ']I:' + status + '_' + n)
              active.subStream[index].input.abort = false
              active.subStream[index].input.fail = false
              if (status === 'done') active.subStream[index].output.done = true
              else active.subStream[index].output.error = true
            } else {
              active.subStream[index].input.ask = true
              log('-> S[' + index + ']I:value_' + n + '(' + x + ')')

              outputValues.push(x)
              if (outputCb) active.subStream[index].output.value = true
            }
          })
        }

        function terminate (status) {
          return function () {
            var n = ++inputIndex
            log('S[' + index + ']I:' + status + '_' + n)
            active.subStream[index].input.ask = false
            active.subStream[index].input.abort = false
            active.subStream[index].input.fail = false
            read(status === 'abort' ? true : new Error('fail'), function (done, x) {
              if (!done) throw new Error('Incorrect execution, receiving value after termination')
              inputDone = done
              var status = done instanceof Error ? 'error' : 'done'
              log('-> S[' + index + ']I:' + status + '_' + n)
              active.subStream[index].output.done = true
              active.subStream[index].output.error = true
            })
          }
        }

        subStreamActions.input.abort = terminate('abort')
        subStreamActions.input.fail = terminate('fail')

        active.subStream[index].output.value = false
        active.subStream[index].output.done = false
        active.subStream[index].output.error = false

        function outputValue (m) {
          return function () {
            active.subStream[index].output.value = false
            active.subStream[index].output.done = false
            active.subStream[index].output.error = false
            var value = outputValues.shift()
            var cb = outputCb
            outputCb = null
            log('S[' + index + ']O:value_' + m + '(' + value + ')')
            cb(false, value)
          }
        }

        function outputDone (m) {
          return function () {
            var cb = outputCb
            outputCb = null
            log('S[' + index + ']O:done_' + m)
            cb(true)
            destroySubStream(index)
          }
        }

        function outputError (m) {
          return function () {
            var cb = outputCb
            outputCb = null
            log('S[' + index + ']O:error_' + m)
            cb(new Error('error'))
            destroySubStream(index)
          }
        }

        return function output (abort, cb) {
          var m = ++outputIndex
          if (abort) {
            var status = abort instanceof Error ? 'fail' : 'abort'
            log('-> S[' + index + ']O:' + status + '_' + m)
            if (inputDone) {
              log('S[' + index + ']O:done_' + m)
              cb(true)
              destroySubStream(index)
            } else {
              if (status === 'fail') subStreamActions.input.fail()
              else subStreamActions.input.abort()
              outputCb = cb
              subStreamActions.output.done = outputDone(m)
              subStreamActions.output.error = outputError(m)
              active.subStream[index].output.done = true
              active.subStream[index].output.error = true
            }
            return
          }

          log('-> S[' + index + ']O:ask_' + m)
          outputCb = cb

          subStreamActions.output.value = outputValue(m)
          subStreamActions.output.done = outputDone(m)
          subStreamActions.output.error = outputError(m)

          if (outputValues.length > 0) {
            active.subStream[index].output.value = true
          } else if (inputDone) {
            active.subStream[index].output.done = true
            active.subStream[index].output.error = true
          }
        }
      }

      var probeIn = checker(true, true)
      var probeOut = checker(true, true)

      pull(
        s,
        probeIn,
        transformer,
        probeOut,
        s
      )
    })
  }

  var lender = LendStream()
  var probeIn = checker(true, true)
  var probeOut = checker(true, true)

  pull(
    input,
    probeIn,
    lender,
    probeOut,
    output()
  )

  function listActions () {
    return JSON.stringify(active)
  }

  function actionsRemaining () {
    return (
      active.input.next ||
      active.output.next ||
      active.lender.createSubStream ||
      Object.keys(active.subStream).length > 0
    )
  }

  function pickAction () {
    var possibilities = []

    if (Object.keys(active.subStream).length > 0) {
      var subStreams = []
      for (var i in actions.subStream) {
        subStreams.push([active.subStream[i], actions.subStream[i]])
      }
      possibilities.push(subStreams)
    }

    if (active.input.next) {
      possibilities.push(actions.input.next)
    }

    if (active.output.next) {
      possibilities.push(actions.output.next)
    }

    if (active.lender.createSubStream) {
      possibilities.push(actions.lender.createSubStream)
    }

    // All previous possibilities are equiprobable, so pick one at random
    var choice = Math.ceil(random() * possibilities.length) - 1
    var action = possibilities[choice]

    // If it does not concern a sub-stream directly, execute
    if (typeof action === 'function') return action()
    else {
      // Pick one of the substreams at random
      var ss = subStreams[Math.ceil(random() * subStreams.length) - 1]
      var activeSubStream = ss[0]
      var subStream = ss[1]

      // Otherwise, be biased towards a correct execution
      var normalSequence = random() <= 0.9
      if (normalSequence && (activeSubStream.input.ask || activeSubStream.output.value || activeSubStream.output.done)) {
        if (random() < 0.5) {
          // Prioritize asking for a value
          if (activeSubStream.input.ask) {
            return subStream.input.ask()
          } else if (activeSubStream.output.value) {
            return subStream.output.value()
          } else {
            return subStream.output.done()
          }
        } else {
          // Prioritize returning values
          if (activeSubStream.output.value) {
            return subStream.output.value()
          } else if (activeSubStream.input.ask) {
            return subStream.input.ask()
          } else {
            return subStream.output.done()
          }
        }
      } else if ((activeSubStream.input.abort || activeSubStream.input.fail) &&
        activeSubStream.output.error) {
        if (random() < 0.5 && (activeSubStream.input.abort || activeSubStream.input.fail)) {
          if (random() < 0.5 && activeSubStream.input.abort) {
            return subStream.input.abort()
          } else {
            return subStream.input.fail()
          }
        } else if (activeSubStream.output.error) {
          return subStream.output.error()
        } else {
          throw new Error('No possible action found')
        }
      } else if (activeSubStream.input.abort || activeSubStream.input.fail) {
        if (random() < 0.5 && activeSubStream.input.abort) {
          return subStream.input.abort()
        } else {
          return subStream.input.fail()
        }
      } else if (activeSubStream.output.error) {
        return subStream.output.error()
      } else if (activeSubStream.output.done) {
        return subStream.output.done()
      } else {
        throw new Error('No possible action found')
      }
    }
  }

  log('')
  while (actionsRemaining()) {
    logActions('before:')
    logActions(listActions())
    pickAction()
    logActions('after:')
    logActions(listActions())
    log('')
  }

  var expectedValues = []
  for (var i = 1; i <= count; ++i) {
    expectedValues.push(i)
  }

  if (outputValues.length !== count) {
    throw new Error('Received ' + outputValues.length + ' while expecting ' + count)
  }

  for (var j = 0; j < count; ++j) {
    if (expectedValues[j] !== outputValues[j]) {
      throw new Error('Received ' + JSON.stringify(outputValues) + ' while expecting ' + JSON.stringify(expectedValues))
    }
  }

  log('Received all expected values ' + JSON.stringify(expectedValues))
}

interleaving.seed = function (s) {
  if (typeof s === 'undefined') return seed

  if (arguments.length === 1 && typeof s === 'number') {
    seed = s
  } else {
    seed = 49734321
  }
}

module.exports = interleaving
