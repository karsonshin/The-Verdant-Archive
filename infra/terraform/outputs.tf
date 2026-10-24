output "namespace" {
  value = kubernetes_namespace.app.metadata[0].name
}

output "next_steps" {
  value = "kubectl apply -f k8s/clusterissuer.yaml && kubectl apply -k k8s/"
}
