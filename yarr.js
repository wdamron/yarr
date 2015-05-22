'use strict';

/*
 * Yet Another React Router.
 * 
 * Copyright (c) 2015 West Damron
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import Immutable from 'immutable';

const MAX_STACK_SIZE = 32;

let __handleChange__ = Symbol('handleChange');
let __runMiddleware__ = Symbol('runMiddleware');
let __prevRouteEntry__ = Symbol('prevRouteEntry');
let __changeQueue__ = Symbol('changeQueue');

let RouteEntryType = Immutable.Record({
  id: null,
  params: Immutable.Map()
});

export function RouteEntry(routeEntry) {
  if (Immutable.Iterable.isAssociative(routeEntry)) {
    return routeEntry;
  }

  let { id, params } = routeEntry;
  params = Immutable.Iterable.isAssociative(params) ? params : Immutable.fromJS(params);

  return new RouteEntryType({ id, params });
}

export class RouterType {

  /*
   * ROUTER INITIALIZATION:
   */

  constructor(options) {
    options = options || {};
    let { onChange, store, defaultRouteEntry } = options;

    if (onChange) {
      this.setChangeHandler(onChange);
    } else {
      this[__handleChange__] = null;
    }

    this.store = store || null;

    if (defaultRouteEntry) {
      this.defaultRouteEntry = defaultRouteEntry;
    } else {
      this.defaultRouteEntry = RouteEntry({
        id: null,
        params: {}
      });
    }

    this.middleware = {};
    this.routes = {};
    this.stack = [];
    this[__prevRouteEntry__] = null;
    // Changes emitted before a change-handler has been registered
    // will be enqueued until one has been registered.
    this[__changeQueue__] = [];
  }

  // If no `RouteEntry` values have been pushed onto the
  // router-stack, the provided `RouteEntry` will be assumed
  // as the current (top) entry in the router-stack.
  setDefaultRouteEntry(routeEntry) {
    routeEntry = RouteEntry(routeEntry);
    this.defaultRouteEntry = routeEntry;
  }

  // When the current (top) `RouteEntry` in the router-stack
  // changes, the provided change handler will be called with
  // the updated current (top) `RouteEntry`.
  //
  // Changes emitted before a change-handler has been registered
  // will be enqueued until one has been registered.
  setChangeHandler(onChange) {
    this[__handleChange__] = (routeEntry) => {
      if (Immutable.is(routeEntry, this[__prevRouteEntry__])) {
        return;
      }
      this[__prevRouteEntry__] = routeEntry;
      onChange(routeEntry, this.routes[routeEntry.id]);
    };

    if (this[__changeQueue__].length) {
      this[__changeQueue__].forEach((routeEntry) => {
        this[__handleChange__](routeEntry);
      });
    }
  }

  // Set the store (optional) associated with this `Router`.
  //
  // `store` may be any value: the provided value will be
  // passed into all middleware handlers to allow inspection
  // of arbitrary state while making routing decisions.
  setStore(store) {
    this.store = store;
  }

  // A middleware handler should have the following signature:
  //
  // (re:RouteEntry [, store:any]) => ReactElement | null
  addMiddleware(middleware) {
    Object.keys(middleware).forEach((name) => {
      this.middleware[name] = middleware[name];
    });
  }

  // A route should have either of the following forms:
  //
  // 1: ReactComponent
  //
  // 2: { middleware: Array<function|string> , component: ReactComponent }
  addRoutes(routes) {
    Object.keys(routes).forEach((name) => {
      this.routes[name] = routes[name];
    });
  }

  /*
   * ROUTER CHANGE HANDLING:
   */

  // Handle changes to the current (top) `RouteEntry` in the router-stack.
  //
  // If no change-handler has been set, changes will be enqueued until
  // one has been set.
  handleChange(routeEntry) {
    if (this[__handleChange__]) {
      this[__handleChange__](routeEntry);
      return;
    }
    this[__changeQueue__].push(routeEntry);
  }

  /*
   * ROUTER-STACK PROPERTY-GETTERS & METHODS:
   */

  // Get the current length of the router-stack.
  get length() {
    return this.stack.length;
  }

  // Get the current (top) `RouteEntry` from the router-stack.
  //
  // If the router-stack is empty, the router's default `RouteEntry`
  // will be returned.
  get currentEntry() {
    let len = this.length;
    return !len ? null : this.stack[len-1];
  }

  // If the given `RouteEntry` is the current (top) entry in the
  // router-stack, return true; otherwise, return false.
  isCurrentEntry(routeEntry) {
    return Immutable.is(RouteEntry(routeEntry), this.currentEntry);
  }

  // Step by `negativeOffset` spaces from the top of the router-stack,
  // and retrieve the `RouteEntry` at that index.
  //
  // `negativeOffset` should be undefined or less-than/equal-to zero.
  //
  // If `negativeOffset` is "falsy", retrieve the `RouteEntry` below the
  // entry at the top of the router-stack.
  peek(negativeOffset) {
    negativeOffset = negativeOffset || 0;
    let len = this.length;
    if (!len || negativeOffset > 0) {
      return null;
    }
    // If negativeOffset was "falsy", retrieve the entry below the top
    // of the router-stack:
    negativeOffset = negativeOffset || -1;
    if (len+negativeOffset < 1) {
      return null;
    }
    return this.stack[len+negativeOffset-1];
  }

  // Push a `RouteEntry` to the top of the router-stack.
  //
  // If the given `RouteEntry` matches the entry at the top of the
  // router-stack, this method is a no-op.
  push(routeEntry) {
    routeEntry = RouteEntry(routeEntry);
    let currentEntry = this.currentEntry;
    if (Immutable.is(routeEntry, currentEntry)) {
      return;
    }
    this.stack.push(routeEntry);

    let route = this.routes[routeEntry.id];
    let middlewareResult = this[__runMiddleware__](route, routeEntry);
    if (middlewareResult) {
      this.push(middlewareResult);
      return;
    }

    while (this.length > MAX_STACK_SIZE) {
      this.stack.shift();
    }
    this.handleChange(routeEntry);
  }

  // Pop a `RouteEntry` from the top of the router-stack.
  //
  // The entry below the popped `RouteEntry` will become the new
  // current (top) entry.
  pop() {
    this.stack.pop();
    let currentEntry = this.currentEntry || this.defaultRouteEntry;
    let route = this.routes[currentEntry.id];
    let middlewareResult = this[__runMiddleware__](route, currentEntry);
    if (middlewareResult) {
      this.push(middlewareResult);
      return;
    }
    this.handleChange(currentEntry);
  }

  // Back is an alias for pop()
  back() {
    this.pop();
  }

  // Replace the current (top) `RouteEntry` in the router-stack with
  // the given `RouteEntry`.
  //
  // This is useful when a new entry in the router-stack is not desired.
  replace(routeEntry) {
    routeEntry = RouteEntry(routeEntry);
    let len = this.length;
    let currentEntry = this.currentEntry;
    if (Immutable.is(routeEntry, currentEntry)) {
      return;
    }

    if (!len) {
      this.stack.push(routeEntry);
    } else {
      this.stack[len-1] = routeEntry;
    }

    let route = this.routes[routeEntry.id];
    let middlewareResult = this[__runMiddleware__](route, routeEntry);
    if (middlewareResult) {
      this.push(middlewareResult);
      return;
    }
    this.handleChange(routeEntry);
  }

  reset() {
    this.stack = [];
  }

  /*
   * ROUTE-MIDDLEWARE HANDLING
   */

  // Run all middleware handlers defined on the given route (if any).
  //
  // If a middleware handler returns a non-null `RouteEntry`, the result
  // should be pushed onto the router-stack.
  //
  // Middleware handlers may retain/pass the given `RouteEntry` as a param in the
  // entry they return, to enable temporary redirects (among other capabilities).
  [__runMiddleware__](route, routeEntry) {
    let middlewareResult = null;

    if (route.middleware) {
      route.middleware.forEach((handler) => {
        if (typeof handler === 'string') {
          handler = this.middleware[handler];
        }
        middlewareResult = handler(routeEntry, this.store);
        if (middlewareResult) {
          return false; // short-circuit forEach loop
        }
      });
    }

    if (middlewareResult) {
      route = this.routes[middlewareResult.id];
      if (route.middleware) {
        return this[__runMiddleware__](route, middlewareResult) || middlewareResult;
      }
      return middlewareResult;
    }

    return null;
  }
}

let DefaultRouter = new RouterType();

export default DefaultRouter;