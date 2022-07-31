import { BigNumber, BigNumberish } from "@ethersproject/bignumber";

export const bn = (value: BigNumberish) => BigNumber.from(value);

export const getSelector = (calldata: string) => calldata.slice(0, 10);
