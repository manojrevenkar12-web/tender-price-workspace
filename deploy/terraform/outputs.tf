output "cluster_name" {
  value = module.eks.cluster_name
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "db_address" {
  value = module.db.db_instance_address
}

output "app_secret_name" {
  value = aws_secretsmanager_secret.app.name
}
