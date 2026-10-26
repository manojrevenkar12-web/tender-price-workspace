data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "tpw-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.13"

  name             = local.name
  cidr             = "10.40.0.0/16"
  azs              = local.azs
  public_subnets   = ["10.40.0.0/20", "10.40.16.0/20", "10.40.32.0/20"]
  private_subnets  = ["10.40.64.0/19", "10.40.96.0/19", "10.40.128.0/19"]
  database_subnets = ["10.40.192.0/24", "10.40.193.0/24", "10.40.194.0/24"]

  create_database_subnet_group = true
  enable_nat_gateway           = true
  single_nat_gateway           = var.environment != "production"
  enable_dns_hostnames         = true

  # Subnet discovery for the AWS Load Balancer Controller.
  public_subnet_tags  = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1 }
}
