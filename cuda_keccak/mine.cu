/*
 * CUDA miner for BuzzCarnival pay_to_mine (same math as pay_to_mine_worker.js).
 *
 * Build (adjust ARCH for your GPU, e.g. sm_80 A100, sm_89 RTX 40xx, sm_90 H100):
 *   nvcc -O3 -std=c++14 -arch=sm_80 mine.cu -o pay_to_mine_gpu
 *
 * Run:
 *   ./pay_to_mine_gpu 0xYourAddress 28
 * Prints one line: decimal nonce (use with pay_to_mine on-chain)
 *
 * Keccak: ethash (Apache-2.0), see ethash_keccak_cuda.cuh
 */
#include "ethash_keccak_cuda.cuh"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cuda_runtime.h>

#define CUDA_OK(call)                                                                                                  \
    do {                                                                                                               \
        cudaError_t e = (call);                                                                                        \
        if (e != cudaSuccess) {                                                                                        \
            fprintf(stderr, "CUDA %s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e));                             \
            exit(1);                                                                                                   \
        }                                                                                                              \
    } while (0)

__global__ void mine_kernel(const uint8_t *addr20, unsigned d, uint64_t start_nonce, uint64_t global_stride, int *found,
                            unsigned long long *found_nonce) {
    uint64_t tid = (uint64_t)blockIdx.x * (uint64_t)blockDim.x + (uint64_t)threadIdx.x;
    uint64_t local_stride = (uint64_t)gridDim.x * (uint64_t)blockDim.x;
    uint64_t nstride = local_stride * global_stride;

    uint8_t a20[20];
#pragma unroll
    for (int i = 0; i < 20; i++)
        a20[i] = addr20[i];

    for (uint64_t nonce = start_nonce + tid * global_stride;; nonce += nstride) {
        if (atomicAdd(found, 0) != 0)
            return;
        uint8_t in[64], h[32];
        build_abi_encode_nonce_address(nonce, a20, in);
        keccak256_bytes_d(in, 64, h);
        if (hash_mod_pow2_zero(h, d)) {
            int old = atomicCAS(found, 0, 1);
            if (old == 0)
                *found_nonce = nonce;
            return;
        }
    }
}

static void parse_address(const char *hex, uint8_t out20[20]) {
    const char *p = hex;
    if (p[0] == '0' && (p[1] == 'x' || p[1] == 'X'))
        p += 2;
    if (strlen(p) != 40) {
        fprintf(stderr, "Expected 40 hex chars for address\n");
        exit(1);
    }
    for (int i = 0; i < 20; i++) {
        unsigned v;
        if (sscanf(p + 2 * i, "%2x", &v) != 1) {
            fprintf(stderr, "Bad hex in address\n");
            exit(1);
        }
        out20[i] = (uint8_t)v;
    }
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <0xAddress> <d_difficulty_uint> [start_nonce] [global_stride]\n", argv[0]);
        fprintf(stderr, "  Example: %s 0xDB1940e77471e238875c60716413137A4080428B 28\n", argv[0]);
        fprintf(stderr, "  Sharded: %s 0xDB1940e77471e238875c60716413137A4080428B 28 3 16\n", argv[0]);
        return 1;
    }
    uint8_t h_addr[20];
    parse_address(argv[1], h_addr);
    unsigned d = (unsigned)strtoul(argv[2], nullptr, 10);
    if (d < 28 || d > 255) {
        fprintf(stderr, "d should be 28..255 (contract requires d>=28)\n");
        return 1;
    }
    uint64_t start_nonce = 0;
    uint64_t global_stride = 1;
    if (argc >= 4) {
        start_nonce = (uint64_t)strtoull(argv[3], nullptr, 10);
    }
    if (argc >= 5) {
        global_stride = (uint64_t)strtoull(argv[4], nullptr, 10);
    }
    if (global_stride == 0) {
        fprintf(stderr, "global_stride must be >= 1\n");
        return 1;
    }

    uint8_t *d_addr = nullptr;
    int *d_found = nullptr;
    unsigned long long *d_nonce = nullptr;
    CUDA_OK(cudaMalloc(&d_addr, 20));
    CUDA_OK(cudaMalloc((void **)&d_found, sizeof(int)));
    CUDA_OK(cudaMalloc((void **)&d_nonce, sizeof(unsigned long long)));
    CUDA_OK(cudaMemcpy(d_addr, h_addr, 20, cudaMemcpyHostToDevice));
    CUDA_OK(cudaMemset(d_found, 0, sizeof(int)));

    int threads = 256;
    int blocks = 0;
    cudaDeviceProp prop;
    CUDA_OK(cudaGetDeviceProperties(&prop, 0));
    blocks = prop.multiProcessorCount * 4;
    if (blocks < 32)
        blocks = 32;

    fprintf(stderr, "GPU %s | blocks=%d threads=%d | d=%u | start=%llu stride=%llu | mining...\n", prop.name, blocks,
            threads, d, (unsigned long long)start_nonce, (unsigned long long)global_stride);

    mine_kernel<<<blocks, threads>>>(d_addr, d, start_nonce, global_stride, d_found, d_nonce);
    CUDA_OK(cudaGetLastError());
    CUDA_OK(cudaDeviceSynchronize());

    int hf = 0;
    unsigned long long nout = 0;
    CUDA_OK(cudaMemcpy(&hf, d_found, sizeof(int), cudaMemcpyDeviceToHost));
    CUDA_OK(cudaMemcpy(&nout, d_nonce, sizeof(nout), cudaMemcpyDeviceToHost));

    cudaFree(d_addr);
    cudaFree(d_found);
    cudaFree(d_nonce);

    if (!hf) {
        fprintf(stderr, "No solution (kernel should not return without one in infinite loop — check errors above)\n");
        return 2;
    }
    printf("%llu\n", (unsigned long long)nout);
    return 0;
}
