resource "aws_security_group" "db" {
  name_prefix = "${local.name}-db-"
  description = "Postgres, reachable from the cluster nodes only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Postgres from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

resource "random_password" "db_master" {
  length  = 32
  special = false
}

resource "random_password" "db_app" {
  length  = 32
  special = false
}

resource "random_password" "token_secret" {
  length  = 48
  special = false
}

resource "random_password" "metrics_token" {
  length  = 32
  special = false
}

module "db" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.9"

  identifier             = local.name
  engine                 = "postgres"
  engine_version         = "17.4"
  family                 = "postgres17"
  create_db_option_group = false
  major_engine_version   = "17"
  instance_class         = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = "tpw"
  username                    = "tpw_admin"
  password                    = random_password.db_master.result
  manage_master_user_password = false
  port                        = 5432

  multi_az               = var.environment == "production"
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.db.id]

  backup_retention_period      = 14
  deletion_protection          = var.environment == "production"
  performance_insights_enabled = true
  apply_immediately            = false

  parameters = [
    # Row-level security policies call functions per row: keep plans honest and log slow ones.
    { name = "log_min_duration_statement", value = "500" },
    { name = "shared_preload_libraries", value = "pg_stat_statements", apply_method = "pending-reboot" },
  ]
}

# Everything the pods need, in one Secrets Manager entry that the External Secrets Operator
# copies into the Secret "tpw-secrets" (deploy/k8s/overlays/production/external-secret.yaml).
resource "aws_secretsmanager_secret" "app" {
  name                    = "tender-price/${var.environment}/app"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL           = "postgres://tpw_app:${random_password.db_app.result}@${module.db.db_instance_address}:5432/tpw?sslmode=require&uselibpqcompat=true"
    MIGRATION_DATABASE_URL = "postgres://tpw_admin:${random_password.db_master.result}@${module.db.db_instance_address}:5432/tpw?sslmode=require&uselibpqcompat=true"
    APP_DB_PASSWORD        = random_password.db_app.result
    TOKEN_SECRET           = random_password.token_secret.result
    METRICS_TOKEN          = random_password.metrics_token.result
    CORS_ORIGIN            = "https://${var.app_host}"
  })
}
