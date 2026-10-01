import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { hexValue } from "@ethersproject/bytes";

export const bn = (value: BigNumberish) => BigNumber.from(value);

export const hex = (value: BigNumberish) => hexValue(bn(value).toHexString());

export const getSelector = (calldata: string) => calldata.slice(0, 10);

export const isPrecompile = (address: string | null) => {
  // Covers zkSync precompiles which have the format `0x0000000000000000000000000000000000008XXX`
  if (address && address.startsWith("0x000000000000000000000000000000000000")) {
    return true;
  }

  return false;
};
