import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { hexValue } from "@ethersproject/bytes";

export const bn = (value: BigNumberish) => BigNumber.from(value);

export const hex = (value: BigNumberish) => hexValue(bn(value).toHexString());

export const getSelector = (calldata: string) => calldata.slice(0, 10);
