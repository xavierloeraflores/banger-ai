// Pinned official llama.cpp b12034 and Meta Q4_K_M artifacts.
export const RUNTIMES: Record<string, { url: string; sha256: string; size: number; archive: string }> = {
  "darwin-arm64": {
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12034/llama-b12034-bin-macos-arm64.tar.gz",
    "sha256": "ce1893ad52bd5db86227624d1777ccc0f2b211d1621cfcd393a886dbd2ac1d9b",
    "size": 16513874,
    "archive": "llama-b12034-bin-macos-arm64.tar.gz"
  },
  "darwin-x64": {
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12034/llama-b12034-bin-macos-x64.tar.gz",
    "sha256": "79f1e86d763d2670a683aff0aa28d2547023f84d63d50cac21c3084f14d15c79",
    "size": 12258895,
    "archive": "llama-b12034-bin-macos-x64.tar.gz"
  },
  "linux-x64": {
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12034/llama-b12034-bin-ubuntu-x64.tar.gz",
    "sha256": "b2c898e15db0da9433de7779e6faee9f4f6801a5c1ed1308a38bf30e492e983b",
    "size": 22887407,
    "archive": "llama-b12034-bin-ubuntu-x64.tar.gz"
  },
  "linux-arm64": {
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12034/llama-b12034-bin-ubuntu-arm64.tar.gz",
    "sha256": "ed19b95e95c9bdf42bdf88d9930400f648bf619a5f48b4bb7b5ab2d7d365aef9",
    "size": 18593064,
    "archive": "llama-b12034-bin-ubuntu-arm64.tar.gz"
  },
  "win32-x64": {
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12034/llama-b12034-bin-win-vulkan-x64.zip",
    "sha256": "df6ab37942d02aeb8ab3de5984711ea866826a94d50f7a9c5960a0d18a9d4269",
    "size": 37523364,
    "archive": "llama-b12034-bin-win-vulkan-x64.zip"
  },
  "win32-arm64": {
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12034/llama-b12034-bin-win-vulkan-arm64.zip",
    "sha256": "6edc6140eaddaea1e0cdbc30e24b542bae4c2621d7ab6321638525887e639c47",
    "size": 25601954,
    "archive": "llama-b12034-bin-win-vulkan-arm64.zip"
  }
};
export const MODELS = { small: {
  "url": "https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF/resolve/b44f1072cf75e918a1b82a3a17b45c4389b076e7/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf",
  "sha256": "4cc57c0f51040a226e5a72cc47b7613f7772950e460a665f7083de89f183f60e",
  "size": 16756683904,
  "name": "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf"
}, dynamic: {
  "url": "https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF/resolve/b44f1072cf75e918a1b82a3a17b45c4389b076e7/Muse-Glimmer-30B-KQuant-Dynamic-Q4_K_XL.gguf",
  "sha256": "ac7023d6a4c704eb9af54ab53e476a66b7f5b6c0ef2fc4a8dde5253c291a6c38",
  "size": 19653960832,
  "name": "Muse-Glimmer-30B-KQuant-Dynamic-Q4_K_XL.gguf"
} } as const;
