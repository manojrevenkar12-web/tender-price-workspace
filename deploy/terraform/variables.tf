variable "region" {
  type    = string
  default = "eu-central-1" # Frankfurt: customer data stays in the EU
}

variable "environment" {
  type    = string
  default = "production"
}

variable "cluster_version" {
  type    = string
  default = "1.31"
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 100
}

variable "app_host" {
  type    = string
  default = "tenders.example"
}
