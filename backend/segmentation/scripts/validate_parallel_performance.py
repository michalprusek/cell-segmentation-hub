#!/usr/bin/env python3
"""
Performance Validation Script for 4-Way Parallel Processing
Validates the performance improvements and memory usage of the enhanced ML service
"""

import asyncio
import time
import statistics
import json
import sys
import os
from pathlib import Path
from typing import List, Dict, Any
import concurrent.futures
import torch
import numpy as np

# Add parent directories to path for imports
sys.path.append(str(Path(__file__).parent.parent))
sys.path.append(str(Path(__file__).parent.parent / "ml"))
sys.path.append(str(Path(__file__).parent.parent / "services"))

from ml.inference_executor import InferenceExecutor, get_global_executor
from services.model_loader import ModelLoader


class ParallelPerformanceValidator:
    """Validates parallel processing performance improvements"""

    def __init__(self):
        self.model_loader = ModelLoader()
        self.test_results = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "gpu_info": self._get_gpu_info(),
            "test_configurations": {},
            "performance_improvements": {},
            "memory_analysis": {},
            "recommendations": []
        }

    def _get_gpu_info(self) -> Dict[str, Any]:
        """Get GPU information"""
        if not torch.cuda.is_available():
            return {"available": False}

        return {
            "available": True,
            "device_name": torch.cuda.get_device_name(0),
            "total_memory_gb": torch.cuda.get_device_properties(0).total_memory / 1024**3,
            "cuda_version": torch.version.cuda,
            "device_count": torch.cuda.device_count()
        }

    def _create_test_input(self, batch_size: int = 1) -> torch.Tensor:
        """Create test input tensor"""
        return torch.randn(batch_size, 3, 256, 256)

    def _measure_sequential_performance(self, model_name: str, iterations: int = 10) -> Dict[str, float]:
        """Measure sequential inference performance"""
        model = self.model_loader.get_model(model_name)
        input_tensor = self._create_test_input()

        # Use original 2-worker executor for comparison
        executor = InferenceExecutor(
            max_workers=1,  # Sequential
            enable_cuda_streams=False,
            enable_monitoring=True
        )

        times = []
        memory_usage = []

        for _ in range(iterations):
            start_time = time.time()

            if torch.cuda.is_available():
                start_memory = torch.cuda.memory_allocated()

            try:
                result = executor.execute_inference(
                    model=model,
                    input_tensor=input_tensor,
                    model_name=model_name,
                    timeout=30.0
                )

                end_time = time.time()
                inference_time = end_time - start_time
                times.append(inference_time)

                if torch.cuda.is_available():
                    end_memory = torch.cuda.memory_allocated()
                    memory_usage.append(end_memory - start_memory)

            except Exception as e:
                print(f"Sequential inference failed: {e}")
                continue

        executor.shutdown()

        return {
            "mean_time": statistics.mean(times) if times else 0,
            "median_time": statistics.median(times) if times else 0,
            "std_time": statistics.stdev(times) if len(times) > 1 else 0,
            "throughput": 1.0 / statistics.mean(times) if times else 0,
            "mean_memory_mb": statistics.mean(memory_usage) / 1024**2 if memory_usage else 0,
            "iterations": len(times)
        }

    def _measure_parallel_performance(self, model_name: str, concurrent_users: int = 4, iterations: int = 10) -> Dict[str, float]:
        """Measure parallel inference performance"""
        model = self.model_loader.get_model(model_name)

        # Use new 4-worker executor with CUDA streams
        executor = InferenceExecutor(
            max_workers=concurrent_users,
            enable_cuda_streams=True,
            enable_monitoring=True
        )

        def run_single_inference():
            input_tensor = self._create_test_input()
            start_time = time.time()

            try:
                result = executor.execute_inference(
                    model=model,
                    input_tensor=input_tensor,
                    model_name=model_name,
                    timeout=30.0
                )
                end_time = time.time()
                return end_time - start_time
            except Exception as e:
                print(f"Parallel inference failed: {e}")
                return None

        # Run concurrent inferences
        all_times = []
        batch_times = []

        for batch in range(iterations):
            batch_start = time.time()

            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrent_users) as thread_executor:
                futures = [thread_executor.submit(run_single_inference) for _ in range(concurrent_users)]
                batch_results = [future.result() for future in futures]

            batch_end = time.time()
            batch_time = batch_end - batch_start
            batch_times.append(batch_time)

            # Collect successful inference times
            valid_times = [t for t in batch_results if t is not None]
            all_times.extend(valid_times)

        executor.shutdown()

        total_inferences = len(all_times)
        total_time = sum(batch_times)

        return {
            "mean_individual_time": statistics.mean(all_times) if all_times else 0,
            "median_individual_time": statistics.median(all_times) if all_times else 0,
            "std_individual_time": statistics.stdev(all_times) if len(all_times) > 1 else 0,
            "mean_batch_time": statistics.mean(batch_times) if batch_times else 0,
            "total_throughput": total_inferences / total_time if total_time > 0 else 0,
            "concurrent_efficiency": (total_inferences / (concurrent_users * total_time)) if total_time > 0 else 0,
            "successful_inferences": total_inferences,
            "total_batches": len(batch_times)
        }

    def _measure_memory_scaling(self, model_name: str) -> Dict[str, Any]:
        """Measure memory usage scaling with concurrent users"""
        if not torch.cuda.is_available():
            return {"available": False}

        model = self.model_loader.get_model(model_name)
        memory_results = {}

        for num_users in [1, 2, 4]:
            executor = InferenceExecutor(
                max_workers=num_users,
                enable_cuda_streams=True,
                enable_monitoring=True
            )

            # Clear memory before test
            torch.cuda.empty_cache()
            initial_memory = torch.cuda.memory_allocated()

            def run_inference():
                input_tensor = self._create_test_input()
                return executor.execute_inference(
                    model=model,
                    input_tensor=input_tensor,
                    model_name=model_name,
                    timeout=10.0
                )

            # Run concurrent inferences and measure peak memory
            peak_memory = initial_memory

            with concurrent.futures.ThreadPoolExecutor(max_workers=num_users) as thread_executor:
                futures = [thread_executor.submit(run_inference) for _ in range(num_users)]

                # Monitor memory during execution
                for _ in range(10):  # Check 10 times during execution
                    current_memory = torch.cuda.memory_allocated()
                    peak_memory = max(peak_memory, current_memory)
                    time.sleep(0.1)

                # Wait for completion
                [future.result() for future in futures]

            final_memory = torch.cuda.memory_allocated()
            memory_used = peak_memory - initial_memory

            memory_results[f"{num_users}_users"] = {
                "peak_memory_mb": memory_used / 1024**2,
                "final_memory_mb": (final_memory - initial_memory) / 1024**2,
                "memory_per_user_mb": memory_used / (num_users * 1024**2)
            }

            executor.shutdown()

        return memory_results

    def validate_model_performance(self, model_name: str) -> Dict[str, Any]:
        """Validate performance for a specific model"""
        print(f"\n=== Validating {model_name} ===")

        try:
            # Load model
            model = self.model_loader.load_model(model_name)
            if model is None:
                return {"error": f"Failed to load model {model_name}"}

            # Sequential performance baseline
            print("Measuring sequential performance...")
            sequential_perf = self._measure_sequential_performance(model_name)

            # Parallel performance
            print("Measuring parallel performance...")
            parallel_perf = self._measure_parallel_performance(model_name)

            # Memory scaling
            print("Measuring memory scaling...")
            memory_scaling = self._measure_memory_scaling(model_name)

            # Calculate improvements
            throughput_improvement = (
                parallel_perf["total_throughput"] / sequential_perf["throughput"]
                if sequential_perf["throughput"] > 0 else 0
            )

            efficiency_score = parallel_perf["concurrent_efficiency"]

            return {
                "model_name": model_name,
                "sequential_performance": sequential_perf,
                "parallel_performance": parallel_perf,
                "memory_scaling": memory_scaling,
                "improvements": {
                    "throughput_multiplier": throughput_improvement,
                    "efficiency_score": efficiency_score,
                    "individual_latency_impact": (
                        parallel_perf["mean_individual_time"] / sequential_perf["mean_time"] - 1
                        if sequential_perf["mean_time"] > 0 else 0
                    )
                }
            }

        except Exception as e:
            return {"error": str(e)}

    def validate_all_models(self) -> Dict[str, Any]:
        """Validate performance for all available models"""
        models_to_test = ["hrnet", "cbam_resunet", "unet_spherohq"]

        print("=== 4-Way Parallel Processing Performance Validation ===")
        print(f"GPU: {self.test_results['gpu_info']}")

        for model_name in models_to_test:
            result = self.validate_model_performance(model_name)
            self.test_results["test_configurations"][model_name] = result

        # Generate overall analysis
        self._analyze_results()

        return self.test_results

    def _analyze_results(self):
        """Analyze results and generate recommendations"""
        successful_tests = {
            name: result for name, result in self.test_results["test_configurations"].items()
            if "error" not in result
        }

        if not successful_tests:
            self.test_results["recommendations"].append("No successful tests - check model loading and GPU availability")
            return

        # Overall performance improvements
        throughput_improvements = []
        efficiency_scores = []

        for model_name, result in successful_tests.items():
            improvements = result.get("improvements", {})
            throughput_improvements.append(improvements.get("throughput_multiplier", 0))
            efficiency_scores.append(improvements.get("efficiency_score", 0))

        avg_throughput_improvement = statistics.mean(throughput_improvements)
        avg_efficiency = statistics.mean(efficiency_scores)

        self.test_results["performance_improvements"] = {
            "average_throughput_multiplier": avg_throughput_improvement,
            "average_efficiency_score": avg_efficiency,
            "best_performing_model": max(
                successful_tests.keys(),
                key=lambda m: successful_tests[m]["improvements"]["throughput_multiplier"]
            ),
            "total_models_tested": len(successful_tests)
        }

        # Generate recommendations
        if avg_throughput_improvement >= 3.5:
            self.test_results["recommendations"].append("Excellent: 4-way parallel processing is highly effective")
        elif avg_throughput_improvement >= 2.5:
            self.test_results["recommendations"].append("Good: Significant performance improvement achieved")
        elif avg_throughput_improvement >= 1.5:
            self.test_results["recommendations"].append("Moderate: Some improvement, consider optimization")
        else:
            self.test_results["recommendations"].append("Poor: Minimal improvement, investigate bottlenecks")

        if avg_efficiency < 0.7:
            self.test_results["recommendations"].append("Low efficiency detected - check for resource contention")

    def save_results(self, filename: str = "parallel_performance_validation.json"):
        """Save validation results to file"""
        output_path = Path(__file__).parent / filename
        with open(output_path, "w") as f:
            json.dump(self.test_results, f, indent=2)
        print(f"\nResults saved to: {output_path}")

    def print_summary(self):
        """Print validation summary"""
        print("\n" + "="*60)
        print("PARALLEL PROCESSING VALIDATION SUMMARY")
        print("="*60)

        if "performance_improvements" in self.test_results:
            perf = self.test_results["performance_improvements"]
            print(f"Average Throughput Improvement: {perf['average_throughput_multiplier']:.2f}x")
            print(f"Average Efficiency Score: {perf['average_efficiency_score']:.2f}")
            print(f"Best Performing Model: {perf['best_performing_model']}")
            print(f"Models Successfully Tested: {perf['total_models_tested']}")

        print("\nRecommendations:")
        for rec in self.test_results["recommendations"]:
            print(f"  • {rec}")

        print("\nDetailed results saved to JSON file for further analysis.")


def main():
    """Main validation function"""
    validator = ParallelPerformanceValidator()

    try:
        results = validator.validate_all_models()
        validator.print_summary()
        validator.save_results()

        # Return success/failure based on performance
        avg_improvement = results.get("performance_improvements", {}).get("average_throughput_multiplier", 0)
        if avg_improvement >= 2.0:  # At least 2x improvement expected
            print("\n✅ Validation PASSED: Significant performance improvement achieved")
            return 0
        else:
            print("\n❌ Validation FAILED: Insufficient performance improvement")
            return 1

    except Exception as e:
        print(f"\n❌ Validation ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())