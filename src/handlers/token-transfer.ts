import { Interface } from "@ethersproject/abi";

import { adjustBalance, CallTrace, GlobalState } from "../simulate";

export const handle = (state: GlobalState, trace: CallTrace) => {
  const iface = new Interface([
    // ERC20
    "function transfer(address to, uint256 value)",
    // ERC20 / ERC721
    "function transferFrom(address from, address to, uint256 valueOrTokenId)",
    // ERC721
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
    // ERC1155
    "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data)",
    "function safeBatchTransferFrom(address from, address to, uint256[] calldata id, uint256[] value, bytes calldata data)",
  ]);

  const selector = trace.input.slice(0, 10);
  switch (true) {
    // ERC20 "transfer"
    case selector === iface.getSighash("transfer"): {
      const args = iface.decodeFunctionData("transfer", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, token, trace.from, args.value.mul(-1));
      adjustBalance(state, token, args.to, args.value);

      break;
    }

    // ERC20 / ERC721 "transferFrom"

    // The ERC20 variant does have a return value
    case selector === iface.getSighash("transferFrom") &&
      trace.output !== "0x": {
      const args = iface.decodeFunctionData("transferFrom", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, token, args.from, args.valueOrTokenId.mul(-1));
      adjustBalance(state, token, args.to, args.valueOrTokenId);

      break;
    }

    // The ERC721 variant has no return value
    case selector === iface.getSighash("transferFrom") &&
      trace.output === "0x": {
      const args = iface.decodeFunctionData("transferFrom", trace.input);
      const token = `erc721:${trace.to}:${args.valueOrTokenId.toString()}`;

      adjustBalance(state, token, args.from, -1);
      adjustBalance(state, token, args.to, 1);

      break;
    }

    // ERC721 "safeTransferFrom"

    case selector ===
      iface.getSighash("safeTransferFrom(address,address,uint256)"): {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256)",
        trace.input
      );
      const token = `erc721:${trace.to}:${args.tokenId.toString()}`;

      adjustBalance(state, token, args.from, -1);
      adjustBalance(state, token, args.to, 1);

      break;
    }

    case selector ===
      iface.getSighash("safeTransferFrom(address,address,uint256,bytes)"): {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256,bytes)",
        trace.input
      );
      const token = `erc721:${trace.to}:${args.tokenId.toString()}`;

      adjustBalance(state, token, args.from, -1);
      adjustBalance(state, token, args.to, 1);

      break;
    }

    // ERC1155 "safeTransferFrom"

    case selector ===
      iface.getSighash(
        "safeTransferFrom(address,address,uint256,uint256,bytes)"
      ): {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256,uint256,bytes)",
        trace.input
      );
      const token = `erc1155:${trace.to}:${args.id.toString()}`;

      adjustBalance(state, token, args.from, args.value.mul(-1));
      adjustBalance(state, token, args.to, args.value);

      break;
    }

    // ERC1155 "safeBatchTransferFrom"

    case selector === iface.getSighash("safeBatchTransferFrom"): {
      const args = iface.decodeFunctionData(
        "safeBatchTransferFrom",
        trace.input
      );

      for (let i = 0; i < args.id.length; i++) {
        const token = `erc721:${trace.to}:${args.id[i].toString()}`;
        adjustBalance(state, token, args.from, -args.value[i].mul(-1));
        adjustBalance(state, token, args.to, args.value[i]);
      }

      break;
    }
  }
};
