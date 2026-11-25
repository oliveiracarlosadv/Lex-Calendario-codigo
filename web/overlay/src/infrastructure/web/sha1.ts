/** SHA-1 síncrono, com o mesmo resultado do app de computador (node:crypto). */
function sha1Hex(text: string) {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  const words = new Uint32Array((((length + 8) >> 6) + 1) * 16);
  for (let i = 0; i < length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[length >> 2] |= 0x80 << (24 - (length % 4) * 8);
  words[words.length - 1] = length * 8;
  const rotl = (n: number, s: number) => (n << s) | (n >>> (32 - s));
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Int32Array(80);
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[block + t] : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [a, b, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      const [f, k] = t < 20 ? [(b & c) | (~b & d), 0x5a827999] : t < 40 ? [b ^ c ^ d, 0x6ed9eba1] : t < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
  }
  return h.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

export function createHash(_algorithm: "sha1") {
  let data = "";
  const api = {
    update(text: string) {
      data += text;
      return api;
    },
    digest: (_encoding: "hex") => sha1Hex(data),
  };
  return api;
}
