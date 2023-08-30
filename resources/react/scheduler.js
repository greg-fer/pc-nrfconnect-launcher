/** @license React v0.19.1
 * scheduler.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

    (function () {
        const enableSchedulerDebugging = false;
        const enableProfiling = true;

        let requestHostCallback;
        let requestHostTimeout;
        let cancelHostTimeout;
        let shouldYieldToHost;
        let requestPaint;

        if (
            // If Scheduler runs in a non-DOM environment, it falls back to a naive
            // implementation using setTimeout.
            typeof window === 'undefined' || // Check if MessageChannel is supported, too.
            typeof MessageChannel !== 'function'
        ) {
            // If this accidentally gets imported in a non-browser environment, e.g. JavaScriptCore,
            // fallback to a naive implementation.
            let _callback = null;
            let _timeoutID = null;

            const _flushCallback = function () {
                if (_callback !== null) {
                    try {
                        const currentTime = exports.unstable_now();
                        const hasRemainingTime = true;

                        _callback(hasRemainingTime, currentTime);

                        _callback = null;
                    } catch (e) {
                        setTimeout(_flushCallback, 0);
                        throw e;
                    }
                }
            };

            const initialTime = Date.now();

            exports.unstable_now = function () {
                return Date.now() - initialTime;
            };

            requestHostCallback = function (cb) {
                if (_callback !== null) {
                    // Protect against re-entrancy.
                    setTimeout(requestHostCallback, 0, cb);
                } else {
                    _callback = cb;
                    setTimeout(_flushCallback, 0);
                }
            };

            requestHostTimeout = function (cb, ms) {
                _timeoutID = setTimeout(cb, ms);
            };

            cancelHostTimeout = function () {
                clearTimeout(_timeoutID);
            };

            shouldYieldToHost = function () {
                return false;
            };

            requestPaint = exports.unstable_forceFrameRate = function () {};
        } else {
            // Capture local references to native APIs, in case a polyfill overrides them.
            const performance = window.performance;
            const _Date = window.Date;
            const _setTimeout = window.setTimeout;
            const _clearTimeout = window.clearTimeout;

            if (typeof console !== 'undefined') {
                // TODO: Scheduler no longer requires these methods to be polyfilled. But
                // maybe we want to continue warning if they don't exist, to preserve the
                // option to rely on it in the future?
                const requestAnimationFrame = window.requestAnimationFrame;
                const cancelAnimationFrame = window.cancelAnimationFrame; // TODO: Remove fb.me link

                if (typeof requestAnimationFrame !== 'function') {
                    // Using console['error'] to evade Babel and ESLint
                    console.error(
                        "This browser doesn't support requestAnimationFrame. " +
                            'Make sure that you load a ' +
                            'polyfill in older browsers. https://fb.me/react-polyfills'
                    );
                }

                if (typeof cancelAnimationFrame !== 'function') {
                    // Using console['error'] to evade Babel and ESLint
                    console.error(
                        "This browser doesn't support cancelAnimationFrame. " +
                            'Make sure that you load a ' +
                            'polyfill in older browsers. https://fb.me/react-polyfills'
                    );
                }
            }

            if (
                typeof performance === 'object' &&
                typeof performance.now === 'function'
            ) {
                exports.unstable_now = function () {
                    return performance.now();
                };
            } else {
                const _initialTime = _Date.now();

                exports.unstable_now = function () {
                    return _Date.now() - _initialTime;
                };
            }

            let isMessageLoopRunning = false;
            let scheduledHostCallback = null;
            let taskTimeoutID = -1; // Scheduler periodically yields in case there is other work on the main
            // thread, like user events. By default, it yields multiple times per frame.
            // It does not attempt to align with frame boundaries, since most tasks don't
            // need to be frame aligned; for those that do, use requestAnimationFrame.

            let yieldInterval = 5;
            let deadline = 0; // TODO: Make this configurable

            {
                // `isInputPending` is not available. Since we have no way of knowing if
                // there's pending input, always yield at the end of the frame.
                shouldYieldToHost = function () {
                    return exports.unstable_now() >= deadline;
                }; // Since we yield every frame regardless, `requestPaint` has no effect.

                requestPaint = function () {};
            }

            exports.unstable_forceFrameRate = function (fps) {
                if (fps < 0 || fps > 125) {
                    // Using console['error'] to evade Babel and ESLint
                    console.error(
                        'forceFrameRate takes a positive int between 0 and 125, ' +
                            'forcing framerates higher than 125 fps is not unsupported'
                    );
                    return;
                }

                if (fps > 0) {
                    yieldInterval = Math.floor(1000 / fps);
                } else {
                    // reset the framerate
                    yieldInterval = 5;
                }
            };

            const performWorkUntilDeadline = function () {
                if (scheduledHostCallback !== null) {
                    const currentTime = exports.unstable_now(); // Yield after `yieldInterval` ms, regardless of where we are in the vsync
                    // cycle. This means there's always time remaining at the beginning of
                    // the message event.

                    deadline = currentTime + yieldInterval;
                    const hasTimeRemaining = true;

                    try {
                        const hasMoreWork = scheduledHostCallback(
                            hasTimeRemaining,
                            currentTime
                        );

                        if (!hasMoreWork) {
                            isMessageLoopRunning = false;
                            scheduledHostCallback = null;
                        } else {
                            // If there's more work, schedule the next message event at the end
                            // of the preceding one.
                            port.postMessage(null);
                        }
                    } catch (error) {
                        // If a scheduler task throws, exit the current browser task so the
                        // error can be observed.
                        port.postMessage(null);
                        throw error;
                    }
                } else {
                    isMessageLoopRunning = false;
                } // Yielding to the browser will give it a chance to paint, so we can
            };

            const channel = new MessageChannel();
            var port = channel.port2;
            channel.port1.onmessage = performWorkUntilDeadline;

            requestHostCallback = function (callback) {
                scheduledHostCallback = callback;

                if (!isMessageLoopRunning) {
                    isMessageLoopRunning = true;
                    port.postMessage(null);
                }
            };

            requestHostTimeout = function (callback, ms) {
                taskTimeoutID = _setTimeout(() => {
                    callback(exports.unstable_now());
                }, ms);
            };

            cancelHostTimeout = function () {
                _clearTimeout(taskTimeoutID);

                taskTimeoutID = -1;
            };
        }

        function push(heap, node) {
            const index = heap.length;
            heap.push(node);
            siftUp(heap, node, index);
        }
        function peek(heap) {
            const first = heap[0];
            return first === undefined ? null : first;
        }
        function pop(heap) {
            const first = heap[0];

            if (first !== undefined) {
                const last = heap.pop();

                if (last !== first) {
                    heap[0] = last;
                    siftDown(heap, last, 0);
                }

                return first;
            }
            return null;
        }

        function siftUp(heap, node, i) {
            let index = i;

            while (true) {
                const parentIndex = (index - 1) >>> 1;
                const parent = heap[parentIndex];

                if (parent !== undefined && compare(parent, node) > 0) {
                    // The parent is larger. Swap positions.
                    heap[parentIndex] = node;
                    heap[index] = parent;
                    index = parentIndex;
                } else {
                    // The parent is smaller. Exit.
                    return;
                }
            }
        }

        function siftDown(heap, node, i) {
            let index = i;
            const length = heap.length;

            while (index < length) {
                const leftIndex = (index + 1) * 2 - 1;
                const left = heap[leftIndex];
                const rightIndex = leftIndex + 1;
                const right = heap[rightIndex]; // If the left or right node is smaller, swap with the smaller of those.

                if (left !== undefined && compare(left, node) < 0) {
                    if (right !== undefined && compare(right, left) < 0) {
                        heap[index] = right;
                        heap[rightIndex] = node;
                        index = rightIndex;
                    } else {
                        heap[index] = left;
                        heap[leftIndex] = node;
                        index = leftIndex;
                    }
                } else if (right !== undefined && compare(right, node) < 0) {
                    heap[index] = right;
                    heap[rightIndex] = node;
                    index = rightIndex;
                } else {
                    // Neither child is smaller. Exit.
                    return;
                }
            }
        }

        function compare(a, b) {
            // Compare sort index first, then task id.
            const diff = a.sortIndex - b.sortIndex;
            return diff !== 0 ? diff : a.id - b.id;
        }

        // TODO: Use symbols?
        const NoPriority = 0;
        const ImmediatePriority = 1;
        const UserBlockingPriority = 2;
        const NormalPriority = 3;
        const LowPriority = 4;
        const IdlePriority = 5;

        let runIdCounter = 0;
        let mainThreadIdCounter = 0;
        const profilingStateSize = 4;
        const sharedProfilingBuffer = // $FlowFixMe Flow doesn't know about SharedArrayBuffer
            typeof SharedArrayBuffer === 'function'
                ? new SharedArrayBuffer(
                      profilingStateSize * Int32Array.BYTES_PER_ELEMENT
                  ) // $FlowFixMe Flow doesn't know about ArrayBuffer
                : typeof ArrayBuffer === 'function'
                ? new ArrayBuffer(
                      profilingStateSize * Int32Array.BYTES_PER_ELEMENT
                  )
                : null; // Don't crash the init path on IE9
        const profilingState =
            sharedProfilingBuffer !== null
                ? new Int32Array(sharedProfilingBuffer)
                : []; // We can't read this but it helps save bytes for null checks

        const PRIORITY = 0;
        const CURRENT_TASK_ID = 1;
        const CURRENT_RUN_ID = 2;
        const QUEUE_SIZE = 3;

        {
            profilingState[PRIORITY] = NoPriority; // This is maintained with a counter, because the size of the priority queue
            // array might include canceled tasks.

            profilingState[QUEUE_SIZE] = 0;
            profilingState[CURRENT_TASK_ID] = 0;
        } // Bytes per element is 4

        const INITIAL_EVENT_LOG_SIZE = 131072;
        const MAX_EVENT_LOG_SIZE = 524288; // Equivalent to 2 megabytes

        let eventLogSize = 0;
        let eventLogBuffer = null;
        let eventLog = null;
        let eventLogIndex = 0;
        const TaskStartEvent = 1;
        const TaskCompleteEvent = 2;
        const TaskErrorEvent = 3;
        const TaskCancelEvent = 4;
        const TaskRunEvent = 5;
        const TaskYieldEvent = 6;
        const SchedulerSuspendEvent = 7;
        const SchedulerResumeEvent = 8;

        function logEvent(entries) {
            if (eventLog !== null) {
                const offset = eventLogIndex;
                eventLogIndex += entries.length;

                if (eventLogIndex + 1 > eventLogSize) {
                    eventLogSize *= 2;

                    if (eventLogSize > MAX_EVENT_LOG_SIZE) {
                        // Using console['error'] to evade Babel and ESLint
                        console.error(
                            "Scheduler Profiling: Event log exceeded maximum size. Don't " +
                                'forget to call `stopLoggingProfilingEvents()`.'
                        );
                        stopLoggingProfilingEvents();
                        return;
                    }

                    const newEventLog = new Int32Array(eventLogSize * 4);
                    newEventLog.set(eventLog);
                    eventLogBuffer = newEventLog.buffer;
                    eventLog = newEventLog;
                }

                eventLog.set(entries, offset);
            }
        }

        function startLoggingProfilingEvents() {
            eventLogSize = INITIAL_EVENT_LOG_SIZE;
            eventLogBuffer = new ArrayBuffer(eventLogSize * 4);
            eventLog = new Int32Array(eventLogBuffer);
            eventLogIndex = 0;
        }
        function stopLoggingProfilingEvents() {
            const buffer = eventLogBuffer;
            eventLogSize = 0;
            eventLogBuffer = null;
            eventLog = null;
            eventLogIndex = 0;
            return buffer;
        }
        function markTaskStart(task, ms) {
            {
                profilingState[QUEUE_SIZE]++;

                if (eventLog !== null) {
                    // performance.now returns a float, representing milliseconds. When the
                    // event is logged, it's coerced to an int. Convert to microseconds to
                    // maintain extra degrees of precision.
                    logEvent([
                        TaskStartEvent,
                        ms * 1000,
                        task.id,
                        task.priorityLevel,
                    ]);
                }
            }
        }
        function markTaskCompleted(task, ms) {
            {
                profilingState[PRIORITY] = NoPriority;
                profilingState[CURRENT_TASK_ID] = 0;
                profilingState[QUEUE_SIZE]--;

                if (eventLog !== null) {
                    logEvent([TaskCompleteEvent, ms * 1000, task.id]);
                }
            }
        }
        function markTaskCanceled(task, ms) {
            {
                profilingState[QUEUE_SIZE]--;

                if (eventLog !== null) {
                    logEvent([TaskCancelEvent, ms * 1000, task.id]);
                }
            }
        }
        function markTaskErrored(task, ms) {
            {
                profilingState[PRIORITY] = NoPriority;
                profilingState[CURRENT_TASK_ID] = 0;
                profilingState[QUEUE_SIZE]--;

                if (eventLog !== null) {
                    logEvent([TaskErrorEvent, ms * 1000, task.id]);
                }
            }
        }
        function markTaskRun(task, ms) {
            {
                runIdCounter++;
                profilingState[PRIORITY] = task.priorityLevel;
                profilingState[CURRENT_TASK_ID] = task.id;
                profilingState[CURRENT_RUN_ID] = runIdCounter;

                if (eventLog !== null) {
                    logEvent([TaskRunEvent, ms * 1000, task.id, runIdCounter]);
                }
            }
        }
        function markTaskYield(task, ms) {
            {
                profilingState[PRIORITY] = NoPriority;
                profilingState[CURRENT_TASK_ID] = 0;
                profilingState[CURRENT_RUN_ID] = 0;

                if (eventLog !== null) {
                    logEvent([
                        TaskYieldEvent,
                        ms * 1000,
                        task.id,
                        runIdCounter,
                    ]);
                }
            }
        }
        function markSchedulerSuspended(ms) {
            {
                mainThreadIdCounter++;

                if (eventLog !== null) {
                    logEvent([
                        SchedulerSuspendEvent,
                        ms * 1000,
                        mainThreadIdCounter,
                    ]);
                }
            }
        }
        function markSchedulerUnsuspended(ms) {
            {
                if (eventLog !== null) {
                    logEvent([
                        SchedulerResumeEvent,
                        ms * 1000,
                        mainThreadIdCounter,
                    ]);
                }
            }
        }

        /* eslint-disable no-var */
        // Math.pow(2, 30) - 1
        // 0b111111111111111111111111111111

        var maxSigned31BitInt = 1073741823; // Times out immediately

        var IMMEDIATE_PRIORITY_TIMEOUT = -1; // Eventually times out

        var USER_BLOCKING_PRIORITY = 250;
        var NORMAL_PRIORITY_TIMEOUT = 5000;
        var LOW_PRIORITY_TIMEOUT = 10000; // Never times out

        var IDLE_PRIORITY = maxSigned31BitInt; // Tasks are stored on a min heap

        var taskQueue = [];
        var timerQueue = []; // Incrementing id counter. Used to maintain insertion order.

        var taskIdCounter = 1; // Pausing the scheduler is useful for debugging.
        var currentTask = null;
        var currentPriorityLevel = NormalPriority; // This is set while performing work, to prevent re-entrancy.

        var isPerformingWork = false;
        var isHostCallbackScheduled = false;
        var isHostTimeoutScheduled = false;

        function advanceTimers(currentTime) {
            // Check for tasks that are no longer delayed and add them to the queue.
            var timer = peek(timerQueue);

            while (timer !== null) {
                if (timer.callback === null) {
                    // Timer was cancelled.
                    pop(timerQueue);
                } else if (timer.startTime <= currentTime) {
                    // Timer fired. Transfer to the task queue.
                    pop(timerQueue);
                    timer.sortIndex = timer.expirationTime;
                    push(taskQueue, timer);

                    {
                        markTaskStart(timer, currentTime);
                        timer.isQueued = true;
                    }
                } else {
                    // Remaining timers are pending.
                    return;
                }

                timer = peek(timerQueue);
            }
        }

        function handleTimeout(currentTime) {
            isHostTimeoutScheduled = false;
            advanceTimers(currentTime);

            if (!isHostCallbackScheduled) {
                if (peek(taskQueue) !== null) {
                    isHostCallbackScheduled = true;
                    requestHostCallback(flushWork);
                } else {
                    var firstTimer = peek(timerQueue);

                    if (firstTimer !== null) {
                        requestHostTimeout(
                            handleTimeout,
                            firstTimer.startTime - currentTime
                        );
                    }
                }
            }
        }

        function flushWork(hasTimeRemaining, initialTime) {
            {
                markSchedulerUnsuspended(initialTime);
            } // We'll need a host callback the next time work is scheduled.

            isHostCallbackScheduled = false;

            if (isHostTimeoutScheduled) {
                // We scheduled a timeout but it's no longer needed. Cancel it.
                isHostTimeoutScheduled = false;
                cancelHostTimeout();
            }

            isPerformingWork = true;
            var previousPriorityLevel = currentPriorityLevel;

            try {
                if (enableProfiling) {
                    try {
                        return workLoop(hasTimeRemaining, initialTime);
                    } catch (error) {
                        if (currentTask !== null) {
                            var currentTime = exports.unstable_now();
                            markTaskErrored(currentTask, currentTime);
                            currentTask.isQueued = false;
                        }

                        throw error;
                    }
                } else {
                    // No catch in prod codepath.
                    return workLoop(hasTimeRemaining, initialTime);
                }
            } finally {
                currentTask = null;
                currentPriorityLevel = previousPriorityLevel;
                isPerformingWork = false;

                {
                    var _currentTime = exports.unstable_now();

                    markSchedulerSuspended(_currentTime);
                }
            }
        }

        function workLoop(hasTimeRemaining, initialTime) {
            var currentTime = initialTime;
            advanceTimers(currentTime);
            currentTask = peek(taskQueue);

            while (currentTask !== null && !enableSchedulerDebugging) {
                if (
                    currentTask.expirationTime > currentTime &&
                    (!hasTimeRemaining || shouldYieldToHost())
                ) {
                    // This currentTask hasn't expired, and we've reached the deadline.
                    break;
                }

                var callback = currentTask.callback;

                if (callback !== null) {
                    currentTask.callback = null;
                    currentPriorityLevel = currentTask.priorityLevel;
                    var didUserCallbackTimeout =
                        currentTask.expirationTime <= currentTime;
                    markTaskRun(currentTask, currentTime);
                    var continuationCallback = callback(didUserCallbackTimeout);
                    currentTime = exports.unstable_now();

                    if (typeof continuationCallback === 'function') {
                        currentTask.callback = continuationCallback;
                        markTaskYield(currentTask, currentTime);
                    } else {
                        {
                            markTaskCompleted(currentTask, currentTime);
                            currentTask.isQueued = false;
                        }

                        if (currentTask === peek(taskQueue)) {
                            pop(taskQueue);
                        }
                    }

                    advanceTimers(currentTime);
                } else {
                    pop(taskQueue);
                }

                currentTask = peek(taskQueue);
            } // Return whether there's additional work

            if (currentTask !== null) {
                return true;
            }
            var firstTimer = peek(timerQueue);

            if (firstTimer !== null) {
                requestHostTimeout(
                    handleTimeout,
                    firstTimer.startTime - currentTime
                );
            }

            return false;
        }

        function unstable_runWithPriority(priorityLevel, eventHandler) {
            switch (priorityLevel) {
                case ImmediatePriority:
                case UserBlockingPriority:
                case NormalPriority:
                case LowPriority:
                case IdlePriority:
                    break;

                default:
                    priorityLevel = NormalPriority;
            }

            var previousPriorityLevel = currentPriorityLevel;
            currentPriorityLevel = priorityLevel;

            try {
                return eventHandler();
            } finally {
                currentPriorityLevel = previousPriorityLevel;
            }
        }

        function unstable_next(eventHandler) {
            var priorityLevel;

            switch (currentPriorityLevel) {
                case ImmediatePriority:
                case UserBlockingPriority:
                case NormalPriority:
                    // Shift down to normal priority
                    priorityLevel = NormalPriority;
                    break;

                default:
                    // Anything lower than normal priority should remain at the current level.
                    priorityLevel = currentPriorityLevel;
                    break;
            }

            var previousPriorityLevel = currentPriorityLevel;
            currentPriorityLevel = priorityLevel;

            try {
                return eventHandler();
            } finally {
                currentPriorityLevel = previousPriorityLevel;
            }
        }

        function unstable_wrapCallback(callback) {
            var parentPriorityLevel = currentPriorityLevel;
            return function () {
                // This is a fork of runWithPriority, inlined for performance.
                var previousPriorityLevel = currentPriorityLevel;
                currentPriorityLevel = parentPriorityLevel;

                try {
                    return callback.apply(this, arguments);
                } finally {
                    currentPriorityLevel = previousPriorityLevel;
                }
            };
        }

        function timeoutForPriorityLevel(priorityLevel) {
            switch (priorityLevel) {
                case ImmediatePriority:
                    return IMMEDIATE_PRIORITY_TIMEOUT;

                case UserBlockingPriority:
                    return USER_BLOCKING_PRIORITY;

                case IdlePriority:
                    return IDLE_PRIORITY;

                case LowPriority:
                    return LOW_PRIORITY_TIMEOUT;

                case NormalPriority:
                default:
                    return NORMAL_PRIORITY_TIMEOUT;
            }
        }

        function unstable_scheduleCallback(priorityLevel, callback, options) {
            var currentTime = exports.unstable_now();
            var startTime;
            var timeout;

            if (typeof options === 'object' && options !== null) {
                var delay = options.delay;

                if (typeof delay === 'number' && delay > 0) {
                    startTime = currentTime + delay;
                } else {
                    startTime = currentTime;
                }

                timeout =
                    typeof options.timeout === 'number'
                        ? options.timeout
                        : timeoutForPriorityLevel(priorityLevel);
            } else {
                timeout = timeoutForPriorityLevel(priorityLevel);
                startTime = currentTime;
            }

            var expirationTime = startTime + timeout;
            var newTask = {
                id: taskIdCounter++,
                callback,
                priorityLevel,
                startTime,
                expirationTime,
                sortIndex: -1,
            };

            {
                newTask.isQueued = false;
            }

            if (startTime > currentTime) {
                // This is a delayed task.
                newTask.sortIndex = startTime;
                push(timerQueue, newTask);

                if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
                    // All tasks are delayed, and this is the task with the earliest delay.
                    if (isHostTimeoutScheduled) {
                        // Cancel an existing timeout.
                        cancelHostTimeout();
                    } else {
                        isHostTimeoutScheduled = true;
                    } // Schedule a timeout.

                    requestHostTimeout(handleTimeout, startTime - currentTime);
                }
            } else {
                newTask.sortIndex = expirationTime;
                push(taskQueue, newTask);

                {
                    markTaskStart(newTask, currentTime);
                    newTask.isQueued = true;
                } // Schedule a host callback, if needed. If we're already performing work,
                // wait until the next time we yield.

                if (!isHostCallbackScheduled && !isPerformingWork) {
                    isHostCallbackScheduled = true;
                    requestHostCallback(flushWork);
                }
            }

            return newTask;
        }

        function unstable_pauseExecution() {}

        function unstable_continueExecution() {
            if (!isHostCallbackScheduled && !isPerformingWork) {
                isHostCallbackScheduled = true;
                requestHostCallback(flushWork);
            }
        }

        function unstable_getFirstCallbackNode() {
            return peek(taskQueue);
        }

        function unstable_cancelCallback(task) {
            {
                if (task.isQueued) {
                    var currentTime = exports.unstable_now();
                    markTaskCanceled(task, currentTime);
                    task.isQueued = false;
                }
            } // Null out the callback to indicate the task has been canceled. (Can't
            // remove from the queue because you can't remove arbitrary nodes from an
            // array based heap, only the first one.)

            task.callback = null;
        }

        function unstable_getCurrentPriorityLevel() {
            return currentPriorityLevel;
        }

        function unstable_shouldYield() {
            var currentTime = exports.unstable_now();
            advanceTimers(currentTime);
            var firstTask = peek(taskQueue);
            return (
                (firstTask !== currentTask &&
                    currentTask !== null &&
                    firstTask !== null &&
                    firstTask.callback !== null &&
                    firstTask.startTime <= currentTime &&
                    firstTask.expirationTime < currentTask.expirationTime) ||
                shouldYieldToHost()
            );
        }

        var unstable_requestPaint = requestPaint;
        var unstable_Profiling = {
            startLoggingProfilingEvents,
            stopLoggingProfilingEvents,
            sharedProfilingBuffer,
        };

        exports.unstable_IdlePriority = IdlePriority;
        exports.unstable_ImmediatePriority = ImmediatePriority;
        exports.unstable_LowPriority = LowPriority;
        exports.unstable_NormalPriority = NormalPriority;
        exports.unstable_Profiling = unstable_Profiling;
        exports.unstable_UserBlockingPriority = UserBlockingPriority;
        exports.unstable_cancelCallback = unstable_cancelCallback;
        exports.unstable_continueExecution = unstable_continueExecution;
        exports.unstable_getCurrentPriorityLevel =
            unstable_getCurrentPriorityLevel;
        exports.unstable_getFirstCallbackNode = unstable_getFirstCallbackNode;
        exports.unstable_next = unstable_next;
        exports.unstable_pauseExecution = unstable_pauseExecution;
        exports.unstable_requestPaint = unstable_requestPaint;
        exports.unstable_runWithPriority = unstable_runWithPriority;
        exports.unstable_scheduleCallback = unstable_scheduleCallback;
        exports.unstable_shouldYield = unstable_shouldYield;
        exports.unstable_wrapCallback = unstable_wrapCallback;
    })();