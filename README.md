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
                sink: (read: (abort, resultCb))
            })),
        source: (abort, resultCb)
    }


Properties
==========

1. If no subStream is read then read is never called.
2. Multiple subStreams can be created by calling lendStream multiple times.
3. Once lendStream has been called:  
  3.1 the borrower will eventually be called either with a subStream or an err;  
  3.2 some borrowers may be called after the stream closed, in which case they
      will either error or obtain a subStream that will abort right away.
4. The lender's source produces results in the order in which the values were
   read by the lender's sink.
5. If a subStream ends before successfully sinking results computed for all
   values read, then the values for missing results are transparently
   migrated to other subStreams.
6. Unfair: if a subStream reads values faster than all other subStreams, it
   will obtain all values.
7. The lender's source closes after its sink has received an abort and all
   subStreams have closed.
8. When the borrower is called, err is thruthy iff:  
   8.1 the lender is not connected yet;  
   8.2 the lender was closed by the source;  
   8.3 all available values have been borrowed, all results have been sourced, and       all subStreams that have borrowed values have closed.

Contraints on the subStreams
============================

1. They should only produce a single result for each value read (currently unenfored, behaviour is unspecified if the constraint is not respected).

