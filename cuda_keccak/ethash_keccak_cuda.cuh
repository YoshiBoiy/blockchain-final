/*
 * Ethereum Keccak-256 (device): adapted from ethash
 * https://github.com/chfast/ethash/blob/master/lib/keccak/keccak.c
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2018 Pawel Bylica.
 */
#ifndef ETHASH_KECCAK_CUDA_CUH
#define ETHASH_KECCAK_CUDA_CUH

#include <cuda_runtime.h>
#include <stdint.h>
#include <string.h>

#ifndef __host__
#define __host__
#endif

#define to_le64(X) (X)

__device__ __forceinline__ uint64_t load_le_d(const uint8_t *data) {
    uint64_t word;
    memcpy(&word, data, sizeof(word));
    return to_le64(word);
}

__device__ __forceinline__ uint64_t rol_d(uint64_t x, unsigned s) {
    return (x << s) | (x >> (64 - s));
}

__device__ static const uint64_t round_constants_d[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL, 0x8000000080008000ULL,
    0x000000000000808bULL, 0x0000000080000001ULL, 0x8000000080008081ULL, 0x8000000000008009ULL,
    0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL,
    0x8000000000008002ULL, 0x8000000000000080ULL, 0x000000000000800aULL, 0x800000008000000aULL,
    0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL};

__device__ __forceinline__ void keccakf1600_implementation_d(uint64_t state[25]) {
    uint64_t Aba, Abe, Abi, Abo, Abu;
    uint64_t Aga, Age, Agi, Ago, Agu;
    uint64_t Aka, Ake, Aki, Ako, Aku;
    uint64_t Ama, Ame, Ami, Amo, Amu;
    uint64_t Asa, Ase, Asi, Aso, Asu;
    uint64_t Eba, Ebe, Ebi, Ebo, Ebu;
    uint64_t Ega, Ege, Egi, Ego, Egu;
    uint64_t Eka, Eke, Eki, Eko, Eku;
    uint64_t Ema, Eme, Emi, Emo, Emu;
    uint64_t Esa, Ese, Esi, Eso, Esu;
    uint64_t Ba, Be, Bi, Bo, Bu;
    uint64_t Da, De, Di, Do, Du;

    Aba = state[0];
    Abe = state[1];
    Abi = state[2];
    Abo = state[3];
    Abu = state[4];
    Aga = state[5];
    Age = state[6];
    Agi = state[7];
    Ago = state[8];
    Agu = state[9];
    Aka = state[10];
    Ake = state[11];
    Aki = state[12];
    Ako = state[13];
    Aku = state[14];
    Ama = state[15];
    Ame = state[16];
    Ami = state[17];
    Amo = state[18];
    Amu = state[19];
    Asa = state[20];
    Ase = state[21];
    Asi = state[22];
    Aso = state[23];
    Asu = state[24];

    for (unsigned n = 0; n < 24; n += 2) {
        Ba = Aba ^ Aga ^ Aka ^ Ama ^ Asa;
        Be = Abe ^ Age ^ Ake ^ Ame ^ Ase;
        Bi = Abi ^ Agi ^ Aki ^ Ami ^ Asi;
        Bo = Abo ^ Ago ^ Ako ^ Amo ^ Aso;
        Bu = Abu ^ Agu ^ Aku ^ Amu ^ Asu;
        Da = Bu ^ rol_d(Be, 1);
        De = Ba ^ rol_d(Bi, 1);
        Di = Be ^ rol_d(Bo, 1);
        Do = Bi ^ rol_d(Bu, 1);
        Du = Bo ^ rol_d(Ba, 1);
        Ba = Aba ^ Da;
        Be = rol_d(Age ^ De, 44);
        Bi = rol_d(Aki ^ Di, 43);
        Bo = rol_d(Amo ^ Do, 21);
        Bu = rol_d(Asu ^ Du, 14);
        Eba = Ba ^ (~Be & Bi) ^ round_constants_d[n];
        Ebe = Be ^ (~Bi & Bo);
        Ebi = Bi ^ (~Bo & Bu);
        Ebo = Bo ^ (~Bu & Ba);
        Ebu = Bu ^ (~Ba & Be);
        Ba = rol_d(Abo ^ Do, 28);
        Be = rol_d(Agu ^ Du, 20);
        Bi = rol_d(Aka ^ Da, 3);
        Bo = rol_d(Ame ^ De, 45);
        Bu = rol_d(Asi ^ Di, 61);
        Ega = Ba ^ (~Be & Bi);
        Ege = Be ^ (~Bi & Bo);
        Egi = Bi ^ (~Bo & Bu);
        Ego = Bo ^ (~Bu & Ba);
        Egu = Bu ^ (~Ba & Be);
        Ba = rol_d(Abe ^ De, 1);
        Be = rol_d(Agi ^ Di, 6);
        Bi = rol_d(Ako ^ Do, 25);
        Bo = rol_d(Amu ^ Du, 8);
        Bu = rol_d(Asa ^ Da, 18);
        Eka = Ba ^ (~Be & Bi);
        Eke = Be ^ (~Bi & Bo);
        Eki = Bi ^ (~Bo & Bu);
        Eko = Bo ^ (~Bu & Ba);
        Eku = Bu ^ (~Ba & Be);
        Ba = rol_d(Abu ^ Du, 27);
        Be = rol_d(Aga ^ Da, 36);
        Bi = rol_d(Ake ^ De, 10);
        Bo = rol_d(Ami ^ Di, 15);
        Bu = rol_d(Aso ^ Do, 56);
        Ema = Ba ^ (~Be & Bi);
        Eme = Be ^ (~Bi & Bo);
        Emi = Bi ^ (~Bo & Bu);
        Emo = Bo ^ (~Bu & Ba);
        Emu = Bu ^ (~Ba & Be);
        Ba = rol_d(Abi ^ Di, 62);
        Be = rol_d(Ago ^ Do, 55);
        Bi = rol_d(Aku ^ Du, 39);
        Bo = rol_d(Ama ^ Da, 41);
        Bu = rol_d(Ase ^ De, 2);
        Esa = Ba ^ (~Be & Bi);
        Ese = Be ^ (~Bi & Bo);
        Esi = Bi ^ (~Bo & Bu);
        Eso = Bo ^ (~Bu & Ba);
        Esu = Bu ^ (~Ba & Be);

        Ba = Eba ^ Ega ^ Eka ^ Ema ^ Esa;
        Be = Ebe ^ Ege ^ Eke ^ Eme ^ Ese;
        Bi = Ebi ^ Egi ^ Eki ^ Emi ^ Esi;
        Bo = Ebo ^ Ego ^ Eko ^ Emo ^ Eso;
        Bu = Ebu ^ Egu ^ Eku ^ Emu ^ Esu;
        Da = Bu ^ rol_d(Be, 1);
        De = Ba ^ rol_d(Bi, 1);
        Di = Be ^ rol_d(Bo, 1);
        Do = Bi ^ rol_d(Bu, 1);
        Du = Bo ^ rol_d(Ba, 1);
        Ba = Eba ^ Da;
        Be = rol_d(Ege ^ De, 44);
        Bi = rol_d(Eki ^ Di, 43);
        Bo = rol_d(Emo ^ Do, 21);
        Bu = rol_d(Esu ^ Du, 14);
        Aba = Ba ^ (~Be & Bi) ^ round_constants_d[n + 1];
        Abe = Be ^ (~Bi & Bo);
        Abi = Bi ^ (~Bo & Bu);
        Abo = Bo ^ (~Bu & Ba);
        Abu = Bu ^ (~Ba & Be);
        Ba = rol_d(Ebo ^ Do, 28);
        Be = rol_d(Egu ^ Du, 20);
        Bi = rol_d(Eka ^ Da, 3);
        Bo = rol_d(Eme ^ De, 45);
        Bu = rol_d(Esi ^ Di, 61);
        Aga = Ba ^ (~Be & Bi);
        Age = Be ^ (~Bi & Bo);
        Agi = Bi ^ (~Bo & Bu);
        Ago = Bo ^ (~Bu & Ba);
        Agu = Bu ^ (~Ba & Be);
        Ba = rol_d(Ebe ^ De, 1);
        Be = rol_d(Egi ^ Di, 6);
        Bi = rol_d(Eko ^ Do, 25);
        Bo = rol_d(Emu ^ Du, 8);
        Bu = rol_d(Esa ^ Da, 18);
        Aka = Ba ^ (~Be & Bi);
        Ake = Be ^ (~Bi & Bo);
        Aki = Bi ^ (~Bo & Bu);
        Ako = Bo ^ (~Bu & Ba);
        Aku = Bu ^ (~Ba & Be);
        Ba = rol_d(Ebu ^ Du, 27);
        Be = rol_d(Ega ^ Da, 36);
        Bi = rol_d(Eke ^ De, 10);
        Bo = rol_d(Emi ^ Di, 15);
        Bu = rol_d(Eso ^ Do, 56);
        Ama = Ba ^ (~Be & Bi);
        Ame = Be ^ (~Bi & Bo);
        Ami = Bi ^ (~Bo & Bu);
        Amo = Bo ^ (~Bu & Ba);
        Amu = Bu ^ (~Ba & Be);
        Ba = rol_d(Ebi ^ Di, 62);
        Be = rol_d(Ego ^ Do, 55);
        Bi = rol_d(Eku ^ Du, 39);
        Bo = rol_d(Ema ^ Da, 41);
        Bu = rol_d(Ese ^ De, 2);
        Asa = Ba ^ (~Be & Bi);
        Ase = Be ^ (~Bi & Bo);
        Asi = Bi ^ (~Bo & Bu);
        Aso = Bo ^ (~Bu & Ba);
        Asu = Bu ^ (~Ba & Be);
    }

    state[0] = Aba;
    state[1] = Abe;
    state[2] = Abi;
    state[3] = Abo;
    state[4] = Abu;
    state[5] = Aga;
    state[6] = Age;
    state[7] = Agi;
    state[8] = Ago;
    state[9] = Agu;
    state[10] = Aka;
    state[11] = Ake;
    state[12] = Aki;
    state[13] = Ako;
    state[14] = Aku;
    state[15] = Ama;
    state[16] = Ame;
    state[17] = Ami;
    state[18] = Amo;
    state[19] = Amu;
    state[20] = Asa;
    state[21] = Ase;
    state[22] = Asi;
    state[23] = Aso;
    state[24] = Asu;
}

/* Same as ethash `keccak` for arbitrary size; bits=256 => Keccak-256 */
__device__ __forceinline__ void keccak_d(uint64_t *out, unsigned bits, const uint8_t *data, unsigned size) {
    const unsigned word_size = 8;
    const unsigned hash_size = bits / 8;
    const unsigned block_size = (1600 - bits * 2) / 8;

    uint64_t state[25] = {0};
    const uint8_t *d = data;

    while (size >= block_size) {
        for (unsigned i = 0; i < (block_size / word_size); ++i) {
            state[i] ^= load_le_d(d);
            d += word_size;
        }
        keccakf1600_implementation_d(state);
        size -= block_size;
    }

    uint64_t *state_iter = state;
    while (size >= word_size) {
        *state_iter ^= load_le_d(d);
        ++state_iter;
        d += word_size;
        size -= word_size;
    }

    uint64_t last_word = 0;
    uint8_t *last_word_iter = (uint8_t *)&last_word;
    while (size > 0) {
        *last_word_iter = *d;
        ++last_word_iter;
        ++d;
        --size;
    }
    *last_word_iter = 0x01;
    *state_iter ^= to_le64(last_word);
    state[(block_size / word_size) - 1] ^= 0x8000000000000000ULL;

    keccakf1600_implementation_d(state);

    for (unsigned i = 0; i < (hash_size / word_size); ++i)
        out[i] = to_le64(state[i]);
}

/* 32-byte digest in same order as ethers `getBytes(keccak256(...))` on little-endian host */
__device__ __forceinline__ void keccak256_bytes_d(const uint8_t *data, unsigned size, uint8_t hash32[32]) {
    uint64_t outw[4];
    keccak_d(outw, 256, data, size);
#pragma unroll
    for (int w = 0; w < 4; w++) {
        uint64_t x = outw[w];
#pragma unroll
        for (int b = 0; b < 8; b++)
            hash32[w * 8 + b] = (uint8_t)(x >> (8 * b));
    }
}

/* abi.encode(uint256 nonce, address) — nonce in lower 8 bytes of first word (fits uint64 mine range) */
__device__ __forceinline__ void build_abi_encode_nonce_address(uint64_t nonce_lo, const uint8_t addr20[20],
                                                                uint8_t out64[64]) {
#pragma unroll
    for (int i = 0; i < 64; i++)
        out64[i] = 0;
#pragma unroll
    for (int b = 0; b < 8; b++)
        out64[31 - b] = (uint8_t)((nonce_lo >> (8 * b)) & 0xff);
#pragma unroll
    for (int i = 0; i < 20; i++)
        out64[44 + i] = addr20[i];
}

/* Solidity: uint256(h) % (1<<d) == 0 */
__device__ __forceinline__ bool hash_mod_pow2_zero(const uint8_t h[32], unsigned d) {
    if (d == 0)
        return true;
    if (d > 256)
        return false;
    unsigned full = d / 8;
    unsigned rem = d % 8;
    for (unsigned i = 0; i < full; i++) {
        if (h[31 - i] != 0)
            return false;
    }
    if (rem == 0)
        return true;
    uint8_t low = h[31 - full];
    uint8_t m = (uint8_t)((1u << rem) - 1u);
    return (low & m) == 0;
}

#endif
