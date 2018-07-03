# Random testing of StreamLender

The tools in this directory enable the execution of interleavings chosen at
random. A single execution is deterministic, i.e. given the same seed and options as
input it will always produce the same execution. This makes it easier to debug
incorrect executions.

A test case consists of:
* A seed
* The number of values in input or output (count)
* The maximum number of concurrent streams of processing (sub-streams)
* The maximum number of sub-streams that can be created

From the seed, one of 4 cases will be chosen with equal probabilities:
1. The number of inputs will be equal to *count*, after which the input
   terminates normally. Outputs will be requested until done or error.
2. Similar to 1. but the input terminates with an error.
3. The number of inputs is potentially infinite. Output will be aborted
   normally after *count* values have be received.
4. Similar to 3. but the output fails rather than aborts.

During execution, one of the next actions may be chosen at random (if available):
1. Produce the next value/done/error on StreamLender's input (after a request has been received)
2. Request the next value/aborts/fail on StreamLender's output 
3. Create a new sub-stream
4. On any currently running sub-stream:
  4.1 Input:
    4.1.1 Request a new input value
    4.1.2 Abort the sub-stream
    4.1.3 Fail the sub-stream

  4.2 Output (after a request has been received):
    4.2.1 Produce a new value 
    4.2.2 Terminate the sub-stream normally (done, after having aborted the input first)
    4.2.3 Terminate the sub-stream abnormally (error, after having failed the input first) 

The choice of the next action to perform is first equiprobable between 1,2,3,
and chosing one of the sub-streams. In case one of the sub-streams has been
chosen, the choice is biased (90% probable) towards a normal execution (4.1.1,
4.2.1, 4.2.2) to ensure quick progress in most cases while still allowing
exceptional cases to occur and be tested.

An execution may be performed by invoking the ````interleaving```` command-line tool, and a trace
of execution may be activated by setting the DEBUG environment variable:
````
  DEBUG=interleaving ./interleaving
````

Other options can be accessed by invoking ````./interleaving --help````.

# Assumptions on sub-streams

The random tests model a transformer that always terminates on its input
before terminating its output. Behaviour when terminating on the output first is unspecified.

# Traces format

The format is an ASCII representation of the Event-Based Notation introduced in https://arxiv.org/abs/1801.06144.
````
    <Event> := <Port>:<Name>_<Index> # Action chosen
            | created S[<Index>]
            | destroyed S[<Index>]   
            | -> <Event>             # Event initiated internally
````

Where:

    * ````<Port>```` can be ````I```` (Input), ````O```` (Output), ````S[<Index>]```` (Sub-stream with index), 
    * ````<Name>```` can be ````ask````, ````abort````, ````fail````, ````value````, ````done````, or ````error````
    * ````<Index>```` is an Integer 

Example:
````
  interleaving count: 1 +0ms
  interleaving parallelism: 1 +3ms
  interleaving seed: 103335400 +4ms
  interleaving normal sequence: false +1ms
  interleaving normal termination: false +0ms
  interleaving inputNb: Infinity +1ms
  interleaving outputNb: 1 +0ms
  interleaving  +2ms
  interleaving created S[1] +2ms
  interleaving -> S[1]O:ask_1 +1ms
  interleaving  +0ms
  interleaving S[1]I:ask_1 +1ms
  interleaving -> I:ask_1 +0ms
  interleaving  +0ms
  interleaving O:ask_1 +1ms
  interleaving  +0ms
  interleaving I:value_1(1) +0ms
  interleaving -> S[1]I:value_1(1) +1ms
  interleaving  +0ms
  interleaving S[1]O:value_1(1) +1ms
  interleaving -> O:value_1(1) +0ms
  interleaving -> S[1]O:ask_2 +0ms
  interleaving  +0ms
  interleaving O:fail_2 +1ms
  interleaving -> I:abort_2 +0ms
  interleaving I:error_2 +0ms
  interleaving  +0ms
  interleaving S[1]I:ask_2 +1ms
  interleaving -> S[1]I:done_2 +0ms
  interleaving  +1ms
  interleaving S[1]O:done_2 +0ms
  interleaving -> O:error_2 +0ms
  interleaving destroyed S[1] +0ms
  interleaving  +0ms
  interleaving Received all expected values [1] +0ms
````

# API

An interleaving can also be invoked programmatically.

````
    var interleaving = require('./interleaving.js')
````

## interleaving(options)

Here are the possible options with the default values:
````
{
  count: 1
  maxSubStreams: 20, 
  parallelism: 1,
  seed: Math.random(),
  normalSequence: random(),     # Boolean, derived from seed
  normalTermination: random(),  # Boolean, derived from seed
}
````

The execution is synchronous and throws an exception if an invariant or a
module property is violated.
