# NVIDIA CUDA miner for pay_to_mine
# Set ARCH to your GPU (nvidia-smi --query-gpu=compute_cap --format=csv)
#   A100: sm_80   H100: sm_90   L40S: sm_89   RTX 4090: sm_89
ARCH ?= sm_80
NVCC ?= nvcc
NVCCFLAGS = -O3 -std=c++14 --use_fast_math -lineinfo -arch=$(ARCH)

pay_to_mine_gpu: mine.cu ethash_keccak_cuda.cuh
	$(NVCC) $(NVCCFLAGS) mine.cu -o pay_to_mine_gpu

clean:
	rm -f pay_to_mine_gpu

.PHONY: clean
