import * as transfers from "./transfers";
import { getSelector } from "../utils";

import type { CallHandler, CallTrace } from "../types";

const genericHandlers: CallHandler[] = [];
const restrictedHandlers: { [selector: string]: CallHandler[] } = {};

let initialized = false;
const initialize = () => {
  for (const handler of [...transfers.handlers]) {
    if (!handler.selector) {
      genericHandlers.push(handler);
    } else {
      if (!restrictedHandlers[handler.selector]) {
        restrictedHandlers[handler.selector] = [];
      }
      restrictedHandlers[handler.selector].push(handler);
    }
  }
};

export const getHandlers = (trace: CallTrace): CallHandler[] => {
  if (!initialized) {
    initialize();
    initialized = true;
  }

  return [
    ...genericHandlers,
    ...(trace.input ? restrictedHandlers[getSelector(trace.input)] ?? [] : []),
  ];
};
